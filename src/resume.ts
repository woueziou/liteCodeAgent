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
import { dirname, resolve } from "node:path";
import { HANDOFF_STALE_MS, inFlightAge, parseJournal, type JournalEntry } from "./report/journal.ts";

export type ResumeProbes = Probes & {
  worktreeExists(path: string): Promise<boolean>;
  /** `null` when git couldn't tell (e.g. the branch doesn't exist at all). */
  commitInBranch(branch: string, commit: string): Promise<boolean | null>;
  /** The branch's current tip sha, or `null` when the branch can't be resolved. */
  headCommit(branch: string): Promise<string | null>;
  /** An open PR's url/number for `branch`, or `null` when there isn't one. */
  openPrForBranch(branch: string): Promise<string | null>;
  /** A merged or closed PR for `branch` (most recent), or `null` when there is none. */
  closedPrForBranch(branch: string): Promise<{ url: string; state: string } | null>;
};

export type ResumeResult =
  | { kind: "no-journal"; findings: Finding[] }
  /** A fresh-context `closer` holds the ticket's tail (ADR 0027): no code work may be resumed. */
  | { kind: "closer-in-flight"; entry: JournalEntry; findings: Finding[]; since?: string; ageMinutes: number; reason: string }
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
  } else if (pr.state === "MERGED" || pr.state === "CLOSED") {
    findings.push({
      severity: "warn",
      message: `PR '${prRef}' is ${pr.state} — the work may already be finished; check before resuming`,
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

/**
 * The primary checkout's root when `root` is a linked worktree, else `root` itself:
 * a worktree's copy of a ticket file is a stale snapshot, the primary checkout's is the
 * one every agent writes notes to (ADR 0015). Falls back to `root` when it can't tell.
 */
export async function primaryCheckoutRoot(root: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "-C", root, "rev-parse", "--git-common-dir"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const lines = (await new Response(proc.stdout).text()).trim().split("\n");
    const out = lines[lines.length - 1]!.trim();
    if ((await proc.exited) !== 0 || !out) return root;
    // The common dir may be relative to `root` (older git has no --path-format=absolute).
    const abs = resolve(root, out);
    return abs.endsWith("/.git") ? dirname(abs) : root;
  } catch {
    return root;
  }
}

/** `ticketBody` is the ticket file's markdown body (frontmatter stripped), notes included. */
export async function resumeState(ticketBody: string, probes: ResumeProbes, now: Date = new Date()): Promise<ResumeResult> {
  const parsed = parseJournal(ticketBody);
  const findings: Finding[] = [];
  const error = (message: string) => findings.push({ severity: "error", message });
  const warn = (message: string) => findings.push({ severity: "warn", message });
  for (const w of parsed.warnings) warn(w);
  if (parsed.unclosedTrailing) error(parsed.unclosedTrailing);

  const entry = parsed.entries[parsed.entries.length - 1];
  if (!entry) return { kind: "no-journal", findings };

  // Single-writer guard (ADR 0027): while a closer holds the ticket's tail, resuming code work
  // would put two writers on one branch. An old marker (closer died) is stale: report it, proceed.
  const age = inFlightAge(entry, now);
  if (age !== undefined) {
    const ageMinutes = Number.isFinite(age) ? Math.floor(age / 60_000) : -1;
    if (age < HANDOFF_STALE_MS) {
      return {
        kind: "closer-in-flight",
        entry,
        findings,
        since: entry.handoffAt,
        ageMinutes,
        reason: `a closer has held this ticket since ${entry.handoffAt} (${ageMinutes} min ago) — not resuming code work while it runs; wait for it, or after ${HANDOFF_STALE_MS / 3_600_000} h treat the marker as stale`,
      };
    }
    warn(
      `stale closer handoff marker (${Number.isFinite(age) ? `${ageMinutes} min old` : "no usable time"}, limit ${HANDOFF_STALE_MS / 3_600_000} h) — the closer is presumed dead, resuming anyway`,
    );
  }

  for (const bad of entry.invalid ?? []) {
    warn(`journal ${bad.field} '${bad.value}' is not a valid ${bad.field === "pr" ? "PR reference (number or URL)" : "commit sha or 'none'"} — ignored`);
  }

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
      } else {
        const closed = await probes.closedPrForBranch(entry.branch);
        if (closed) {
          warn(`branch '${entry.branch}' has a ${closed.state} PR (${closed.url}) the journal never recorded — the work may already be finished`);
        }
      }
    }
  }

  return { kind: "resolved", entry, findings, resumeAt: nextStep(entry, findings) };
}
