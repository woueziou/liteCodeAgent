/** The real `git`/`gh`/ticket-buffer lookups behind `verifyReport`. Read-only throughout. */

import { gh, GhError } from "../gh.ts";
import { listTickets } from "../tickets/store.ts";
import { parseTicket, type StatusRole, type Ticket } from "../tickets/spec.ts";
import type { PrLookup, Probes } from "./verify.ts";

async function git(root: string, args: string[]): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, code };
}

async function refExists(root: string, ref: string): Promise<boolean> {
  return (await git(root, ["rev-parse", "--verify", "--quiet", ref])).code === 0;
}

/**
 * Only gh's own "this PR doesn't exist" wordings. A generic "not found" (a mistyped repo,
 * a visibility or auth problem) says nothing about the report, so it must stay `unknown`.
 */
const PR_NOT_FOUND = /no pull requests? found|could not resolve to a pullrequest/i;

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

    async ticketStatuses(issue, branch) {
      const tickets = await listTickets(root, ticketsDir);
      const byIssue = /^#(\d+)$/.exec(issue);
      const match = (t: Ticket) => (byIssue ? t.issue === Number(byIssue[1]) : t.id === issue || t.id.startsWith(`${issue}-`));
      const statuses = new Set<StatusRole>();

      const local = tickets.find(match);
      if (local) statuses.add(local.status);

      if (local && branch) {
        const tip = (await refExists(root, `refs/heads/${branch}`)) ? branch : `origin/${branch}`;
        const shown = await git(root, ["show", `${tip}:${local.path}`]);
        if (shown.code === 0) {
          try {
            statuses.add(parseTicket(shown.stdout, local.path).status);
          } catch {
            // A malformed copy on the branch is `ticket doctor`'s business, not this check's.
          }
        }
      }
      return [...statuses];
    },
  };
}
