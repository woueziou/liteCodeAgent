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

const PR_NOT_FOUND = /no pull requests? found|could not resolve to a pullrequest|not found/i;

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

    async dirtyFiles() {
      const { stdout } = await git(root, ["status", "--porcelain"]);
      return stdout
        .split("\n")
        .filter((l) => l.length > 3)
        .map((l) => l.slice(3).split(" -> ").pop()!.replace(/^"|"$/g, ""));
    },

    async branchFiles(branch) {
      const ref = (await refExists(root, `refs/heads/${branch}`)) ? branch : `origin/${branch}`;
      const { stdout, code } = await git(root, ["diff", "--name-only", `${defaultBranch}...${ref}`]);
      return code === 0 ? stdout.split("\n").filter(Boolean) : [];
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
