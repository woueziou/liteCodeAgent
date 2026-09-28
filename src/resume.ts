/**
 * `litecode resume <ticket>` (ticket 0034): reconstructs where an `implementer` run left
 * off, from its progress journal note on the ticket, cross-checked against the repo the
 * same way `verify-report` cross-checks a final report — reusing the same `Probes` shape
 * from `src/report/verify.ts` (branch/PR/ticket-status lookups) plus two resume-specific
 * probes (worktree presence, commit reachability) that no other command needs.
 *
 * This complements `litecode doctor` rather than duplicating it: `doctor` scans every
 * ticket for orphaned work with no journal to go on at all; `resume` is pointed at one
 * ticket that already has a journal and answers "where do I pick this back up, precisely".
 */

import type { Finding, PrLookup, Probes } from "./report/verify.ts";
import { latestJournalEntry, type JournalEntry } from "./report/journal.ts";

export type ResumeProbes = Probes & {
  worktreeExists(path: string): Promise<boolean>;
  /** `null` when git couldn't tell (e.g. the branch doesn't exist at all). */
  commitInBranch(branch: string, commit: string): Promise<boolean | null>;
  /** The branch's current tip sha, or `null` when the branch can't be resolved. */
  headCommit(branch: string): Promise<string | null>;
  /** An open PR's url/number for `branch`, or `null` when there isn't one. */
  openPrForBranch(branch: string): Promise<string | null>;
};

export type ResumeResult =
  | { kind: "no-journal" }
  | { kind: "resolved"; entry: JournalEntry; findings: Finding[]; resumeAt: string };

function describePr(pr: PrLookup, prRef: string, findings: Finding[], branch: string | undefined): void {
  if (pr.kind === "missing") {
    findings.push({ severity: "error", message: `PR '${prRef}' does not resolve to a pull request` });
  } else if (pr.kind === "unknown") {
    findings.push({ severity: "warn", message: `could not look up PR '${prRef}': ${pr.reason}` });
  } else if (branch && pr.headRefName !== branch) {
    findings.push({
      severity: "error",
      message: `PR '${prRef}' is for branch '${pr.headRefName}', not the journal's branch '${branch}'`,
    });
  }
}

function nextStep(entry: JournalEntry, findings: Finding[]): string {
  if (findings.some((f) => f.severity === "error")) {
    return "state diverges from the journal — resolve the discrepancies above before resuming";
  }
  if (entry.adrPath) {
    return `resume at the ADR draft approval gate for '${entry.adrPath}' (adr_posted=${entry.adrPosted ?? false})`;
  }
  if (entry.pr) return `resume after the PR was opened (${entry.pr}) — check reviewer/bug-hunter status`;
  if (entry.commit && entry.commit !== "none") {
    return `resume after step "${entry.step}" — last commit ${entry.commit} on branch ${entry.branch ?? "?"}`;
  }
  return `resume at step "${entry.step}"`;
}

/** `ticketBody` is the ticket file's markdown body (frontmatter stripped), notes included. */
export async function resumeState(ticketBody: string, probes: ResumeProbes): Promise<ResumeResult> {
  const entry = latestJournalEntry(ticketBody);
  if (!entry) return { kind: "no-journal" };

  const findings: Finding[] = [];
  const error = (message: string) => findings.push({ severity: "error", message });
  const warn = (message: string) => findings.push({ severity: "warn", message });

  if (entry.worktree && !(await probes.worktreeExists(entry.worktree))) {
    warn(`worktree '${entry.worktree}' no longer exists — recreate it from branch '${entry.branch ?? "?"}' if resuming`);
  }

  if (entry.branch && !(await probes.branchExists(entry.branch))) {
    error(`branch '${entry.branch}' does not exist locally or on origin`);
  }

  if (entry.commit && entry.commit !== "none") {
    if (!entry.branch) {
      warn(`journal has commit '${entry.commit}' but no branch to check it against`);
    } else {
      const inBranch = await probes.commitInBranch(entry.branch, entry.commit);
      if (inBranch === false) {
        error(`commit '${entry.commit}' from the journal is not reachable on branch '${entry.branch}' — journal is stale or the branch was rewritten`);
      } else if (inBranch === null) {
        warn(`could not verify commit '${entry.commit}' is on branch '${entry.branch}'`);
      }
    }
  }

  if (entry.pr) {
    const pr = await probes.prView(entry.pr);
    describePr(pr, entry.pr, findings, entry.branch);
  }

  // A journal is only as good as its last write: if the branch or the PR moved on since,
  // resume must say so rather than hand back stale state as if it were current (ticket 0049).
  if (entry.branch && !findings.some((f) => f.severity === "error")) {
    const head = await probes.headCommit(entry.branch);
    // The journal may hold an abbreviated sha (implementer.md only asks for "sha of last
    // local commit", and `git commit` prints a 7-char one) in any case, so this must compare
    // as a case-insensitive prefix of the full tip sha, not for exact equality — otherwise
    // every abbreviated or differently-cased (but still current) commit looks stale.
    if (head && entry.commit && entry.commit !== "none" && !head.toLowerCase().startsWith(entry.commit.toLowerCase())) {
      warn(`branch '${entry.branch}' has moved to '${head}' since the journal recorded '${entry.commit}' — journal is behind the repo`);
    }

    if (!entry.pr) {
      const openPr = await probes.openPrForBranch(entry.branch);
      if (openPr) {
        warn(`branch '${entry.branch}' has an open PR (${openPr}) the journal never recorded — journal is behind the repo`);
      }
    }
  }

  return { kind: "resolved", entry, findings, resumeAt: nextStep(entry, findings) };
}
