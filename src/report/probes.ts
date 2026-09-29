/** The real `git`/`gh`/ticket-buffer lookups behind `verifyReport` and `resumeState`. Read-only throughout. */

import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gh, GhError } from "../gh.ts";
import { listTickets } from "../tickets/store.ts";
import type { ResumeProbes } from "../resume.ts";
import type { PrChecksLookup, PrLookup, Probes } from "./verify.ts";

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

/** `gh pr checks` says this, rather than returning an empty JSON array, on a repo with no CI. */
const PR_NO_CHECKS = /no checks reported/i;

export type ProbeContext = { root: string; repo: string; ticketsDir: string };

export function realProbes(ctx: ProbeContext): Probes {
  const { root, repo, ticketsDir } = ctx;

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
     * The PR's CI state (ticket 0054), collapsed from `gh pr checks`'s per-check `bucket`
     * field: any `fail`/`cancel` wins outright, then any still-running (`pending`), then a
     * clean `pass`/`skipping` mix counts as passing. This bypasses the shared `gh()`
     * wrapper deliberately: `gh pr checks` exits 8 (non-zero) while checks are still
     * pending, but still prints the JSON `--json bucket` was asked for on stdout — `gh()`
     * throws away stdout on any non-zero exit, which would misreport every pending run as
     * `unknown`. A repo with no CI configured prints "no checks reported" on stderr with
     * no JSON at all, which is `none`, not `unknown` — it isn't itself a problem.
     */
    async prChecks(pr): Promise<PrChecksLookup> {
      const args = ["pr", "checks", pr, "--json", "bucket"];
      if (!/^https?:\/\//.test(pr)) args.push("--repo", repo);
      const proc = Bun.spawn([process.env.LITECODE_GH_BIN || "gh", ...args], {
        env: process.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      await proc.exited;
      try {
        const rows = JSON.parse(stdout) as { bucket: string }[];
        if (rows.length === 0) return { kind: "none" };
        if (rows.some((r) => r.bucket === "fail" || r.bucket === "cancel")) return { kind: "fail" };
        if (rows.some((r) => r.bucket === "pending")) return { kind: "pending" };
        return { kind: "pass" };
      } catch {
        if (PR_NO_CHECKS.test(stderr)) return { kind: "none" };
        return { kind: "unknown", reason: (stderr || `gh pr checks exited with no parseable output`).trim().split("\n")[0]! };
      }
    },

    /** A ticket is named by its id (`0030-slug`) or its number (`0030`, `30`, `#0030`). */
    async ticketStatus(ref) {
      const tickets = await listTickets(root, ticketsDir);
      const bare = ref.replace(/^#/, "");
      const key = /^\d{1,4}$/.test(bare) ? bare.padStart(4, "0") : bare;
      return tickets.find((t) => t.id === key || t.id.startsWith(`${key}-`))?.status;
    },
  };
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
