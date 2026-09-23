/** The real `git`/`gh`/ticket-buffer lookups behind `verifyReport`. Read-only throughout. */

import { gh, GhError } from "../gh.ts";
import { listTickets } from "../tickets/store.ts";
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

export type ProbeContext = { root: string; repo: string; defaultBranch: string; ticketsDir: string };

export function realProbes(ctx: ProbeContext): Probes {
  const { root, repo, defaultBranch, ticketsDir } = ctx;

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
    // never match between `status` and `diff` and silently downgrade a leak to a warning.
    // `--untracked-files=all` for the same reason: by default a new file in a new directory
    // shows up only as that directory, which never matches the branch's file paths.
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
      return paths;
    },

    async branchFiles(branch) {
      const ref = (await refExists(root, `refs/heads/${branch}`)) ? branch : `origin/${branch}`;
      const { stdout, code } = await git(root, ["diff", "--name-only", "-z", `${defaultBranch}...${ref}`]);
      return code === 0 ? stdout.split("\0").filter(Boolean) : [];
    },

    async ticketStatus(issue) {
      const tickets = await listTickets(root, ticketsDir);
      const byIssue = /^#(\d+)$/.exec(issue);
      const match = byIssue
        ? tickets.find((t) => t.issue === Number(byIssue[1]))
        : tickets.find((t) => t.id === issue || t.id.startsWith(`${issue}-`));
      return match?.status;
    },
  };
}
