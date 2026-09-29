/** The real `git`/`gh`/ticket-buffer lookups behind `verifyReport` and `resumeState`. Read-only throughout. */

import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gh, GhError, RateLimitError } from "../gh.ts";
import { classifyChecks, parseCheckRows, PR_NO_CHECKS } from "./checks.ts";
import { listTickets } from "../tickets/store.ts";
import type { ResumeProbes } from "../resume.ts";
import type { ForcePushLookup, PrChecksLookup, PrLookup, Probes } from "./verify.ts";

async function git(root: string, args: string[]): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, code };
}

async function refExists(root: string, ref: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "--quiet", ref])).code === 0;
}

/**
 * The primary checkout's root, even when `root` is itself a linked worktree — `implementer`
 * always writes journal `worktree:` paths (e.g. `../worktrees/0049`) relative to the primary
 * checkout it ran step 2/3 from, so resolving them against whatever directory `resume` was
 * launched from (`root`) gives the wrong answer the moment `resume` runs from inside a
 * worktree itself (ticket 0049). `git rev-parse --git-common-dir` names the shared `.git`
 * directory every worktree of a repo points back to; its parent is the primary checkout.
 */
async function primaryCheckoutRoot(root: string): Promise<string> {
  const { stdout, code } = await git(root, ["rev-parse", "--git-common-dir"]);
  if (code !== 0) return root;
  const commonDir = stdout.trim();
  if (!commonDir) return root;
  const absoluteCommonDir = resolve(root, commonDir);
  return dirname(absoluteCommonDir);
}

/**
 * Only gh's own "this PR doesn't exist" wordings. A generic "not found" (a mistyped repo,
 * a visibility or auth problem) says nothing about the report, so it must stay `unknown`.
 */
const PR_NOT_FOUND = /no pull requests? found|could not resolve to a pullrequest/i;

export type ProbeContext = {
  root: string;
  repo: string;
  ticketsDir: string;
  /** CI check names that must have passed for a green CI to count (default `["test"]`; ticket 0059). */
  testChecks?: string[];
  /** How long `prChecks` keeps polling for checks not yet registered, and how often. */
  noChecksWait?: { retries: number; intervalMs: number };
};

export function realProbes(ctx: ProbeContext): Probes {
  const { root, repo, ticketsDir, testChecks, noChecksWait } = ctx;

  return {
    async branchExists(branch) {
      return (await refExists(root, `refs/heads/${branch}`)) || (await refExists(root, `refs/remotes/origin/${branch}`));
    },

    async prView(pr): Promise<PrLookup> {
      const args = ["pr", "view", pr, "--json", "headRefName,state"];
      if (!/^https?:\/\//.test(pr)) args.push("--repo", repo);
      try {
        const { headRefName, state } = JSON.parse(await gh(args)) as { headRefName: string; state: string };
        return { kind: "found", headRefName, state };
      } catch (e) {
        if (e instanceof GhError && PR_NOT_FOUND.test(e.message)) return { kind: "missing" };
        return { kind: "unknown", reason: (e as Error).message.split("\n")[0]! };
      }
    },

    // `-z` everywhere: without it git quotes and octal-escapes non-ASCII paths, which would
    // never match between `status` and `log` and silently downgrade a leak to a warning.
    // `--untracked-files=all` for the same reason: by default a new file in a new directory
    // shows up only as that directory, which never matches the branch's file paths.
    // Ticket files are left out: step 2 of the implementer's flow writes the ticket's
    // status in the primary checkout on purpose, before its worktree exists.
    async dirtyFiles() {
      const entries = (await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"])).stdout.split("\0");
      const paths: string[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (entry.length < 4) continue;
        paths.push(entry.slice(3));
        // A rename/copy entry is followed by its original path, which isn't dirty itself.
        if (entry[0] === "R" || entry[0] === "C") i++;
      }
      const ticketsPrefix = `${ticketsDir.replace(/\/+$/, "")}/`;
      return paths.filter((p) => !p.startsWith(ticketsPrefix));
    },

    /**
     * Files touched by the commits only this branch has — not a diff against the default
     * branch, which would also count a parent PR's files when the implementer based the
     * branch on another unmerged PR branch.
     */
    async branchFiles(branch) {
      const self = new Set([`refs/heads/${branch}`, `refs/remotes/origin/${branch}`, "refs/remotes/origin/HEAD"]);
      const refs = await git(root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
      if (refs.code !== 0) return null;
      const others = refs.stdout.split("\n").filter((r) => r && !self.has(r));
      const tip = (await refExists(root, `refs/heads/${branch}`)) ? `refs/heads/${branch}` : `refs/remotes/origin/${branch}`;
      const log = await git(root, ["log", "-z", "--name-only", "--format=", tip, "--not", ...others]);
      if (log.code !== 0) return null;
      return [...new Set(log.stdout.split("\0").map((p) => p.trim()).filter(Boolean))];
    },

    /**
     * The PR's CI state (ticket 0054, tightened by 0059), collapsed by `classifyChecks`.
     *
     * Verified against gh 2.101.0: `gh pr checks --json name,bucket` prints the JSON array
     * on stdout, and exits 0 when every check passed, 1 when one failed (JSON still
     * printed), 8 while some are pending (JSON still printed), and 1 with "no checks
     * reported on the '<branch>' branch" on stderr and no JSON when nothing is registered
     * yet. So the call goes through the shared `gh()` wrapper (rate-limit retries and
     * quota reporting included) and reads the JSON off the `GhError` it throws for those
     * non-zero exits.
     *
     * Right after a push, checks may not be registered yet, or only a third-party check
     * has: both are polled for a bounded time (`noChecksWait`) before concluding `none` /
     * `no-test-check` (`retries` extra polls, `intervalMs` apart), since a stacked PR never
     * triggers the base-branch workflow.
     */
    async prChecks(pr): Promise<PrChecksLookup> {
      const args = ["pr", "checks", pr, "--json", "name,bucket"];
      if (!/^https?:\/\//.test(pr)) args.push("--repo", repo);
      const expected = testChecks ?? ["test"];
      const { retries, intervalMs } = noChecksWait ?? { retries: 6, intervalMs: 5_000 };
      for (let attempt = 0; ; attempt++) {
        let result: PrChecksLookup;
        try {
          let stdout: string;
          try {
            stdout = await gh(args);
          } catch (e) {
            if (e instanceof RateLimitError || !(e instanceof GhError)) throw e;
            // Non-zero exit that still printed the rows (fail = 1, pending = 8).
            // An empty array next to an unrelated error (HTTP 502) is a failure, not "no CI".
            if (!(parseCheckRows(e.stdout)?.length ?? 0) && !PR_NO_CHECKS.test(e.message)) throw e;
            stdout = e.stdout;
          }
          result = classifyChecks(parseCheckRows(stdout) ?? [], expected);
        } catch (e) {
          return { kind: "unknown", reason: reasonOf(e) };
        }
        if ((result.kind !== "none" && result.kind !== "no-test-check") || attempt >= retries) return result;
        await Bun.sleep(intervalMs);
      }
    },

    /** A ticket is named by its id (`0030-slug`) or its number (`0030`, `30`, `#0030`). */
    async ticketStatus(ref) {
      const tickets = await listTickets(root, ticketsDir);
      const bare = ref.replace(/^#/, "");
      const key = /^\d{1,4}$/.test(bare) ? bare.padStart(4, "0") : bare;
      return tickets.find((t) => t.id === key || t.id.startsWith(`${key}-`))?.status;
    },

    /**
     * Ticket 0056: whether the PR's head ref was ever force-pushed, from GitHub's own
     * `head_ref_force_pushed` timeline event — the one artefact that survives independently
     * of any agent's self-report. Resolves the PR to its issue number first (`pr` may be a
     * number or a full URL, same as every other probe here), then walks that issue's
     * events, since the events endpoint only takes a bare number, never a URL.
     */
    async forcePushed(pr): Promise<ForcePushLookup> {
      const viewArgs = ["pr", "view", pr, "--json", "number,url"];
      if (!/^https?:\/\//.test(pr)) viewArgs.push("--repo", repo);
      let number: number;
      let ownerRepo: string;
      try {
        const view = JSON.parse(await gh(viewArgs)) as { number: number; url: string };
        number = view.number;
        // The PR's number and events live on the BASE repo (the one in its URL), never on
        // the head repo a fork PR was pushed from.
        ownerRepo = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+/i.exec(view.url)?.[1] ?? repo;
      } catch (e) {
        return { kind: "unknown", reason: reasonOf(e) };
      }
      try {
        const out = await gh(["api", `repos/${ownerRepo}/issues/${number}/events`, "--paginate", "--jq", ".[].event"]);
        const count = out.split("\n").filter((line) => line.trim() === "head_ref_force_pushed").length;
        return count > 0 ? { kind: "yes", count } : { kind: "no" };
      } catch (e) {
        return { kind: "unknown", reason: reasonOf(e) };
      }
    },
  };
}

/** A `GhError` message is "gh … failed (exit N):\n<stderr>": the stderr line is the actual reason. */
function reasonOf(e: unknown): string {
  return (e as Error).message.replace(/\s*\n\s*/g, " ").trim();
}

/** Adds `resumeState`'s two extra probes (worktree presence, commit reachability) to `realProbes`. */
export function realResumeProbes(ctx: ProbeContext): ResumeProbes {
  const { root, repo } = ctx;
  return {
    ...realProbes(ctx),

    async worktreeExists(path) {
      try {
        const base = await primaryCheckoutRoot(root);
        return (await stat(resolve(base, path))).isDirectory();
      } catch {
        return false;
      }
    },

    async commitInBranch(branch, commit) {
      const branchExists =
        (await refExists(root, `refs/heads/${branch}`)) || (await refExists(root, `refs/remotes/origin/${branch}`));
      if (!branchExists) return null;
      const ref = (await refExists(root, `refs/heads/${branch}`)) ? branch : `origin/${branch}`;
      if (!(await refExists(root, commit))) return null;
      const { code } = await git(root, ["merge-base", "--is-ancestor", commit, ref]);
      return code === 0;
    },

    async headCommit(branch) {
      const ref = (await refExists(root, `refs/heads/${branch}`))
        ? `refs/heads/${branch}`
        : `refs/remotes/origin/${branch}`;
      const { stdout, code } = await git(root, ["rev-parse", ref]);
      return code === 0 ? stdout.trim() : null;
    },

    async openPrForBranch(branch) {
      try {
        const out = await gh(["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--repo", repo]);
        const prs = JSON.parse(out) as { number: number; url: string }[];
        return prs.length > 0 ? prs[0]!.url : null;
      } catch {
        return null;
      }
    },
  };
}
