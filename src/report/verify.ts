/**
 * Cross-checks an `implementer`'s final report against the state it claims to have left
 * behind (ticket 0017). An agent's own account of its run is not evidence: on one session,
 * three implementers out of a dozen returned an empty placeholder, a false "working tree
 * clean", or a fabricated reviewer verdict, and each was only caught by a human comparing
 * the report to `git`/`gh` by hand. This does that comparison mechanically, for the parts
 * of the report that name something checkable: the branch, the PR, the ticket's status,
 * and whether the primary checkout was written to instead of the worktree.
 *
 * `verifyReport` is pure over a `Probes` value so every rule is testable without a repo or
 * network; `src/report/probes.ts` supplies the real `git`/`gh`/ticket-buffer lookups.
 */

import type { StatusRole } from "../tickets/spec.ts";

export const REPORT_STATUSES = [
  "in-progress-blocked",
  "pr-opened-for-review",
  "verified-no-changes-needed",
  "blocked-github-unavailable",
  "implemented-pending-github",
  "adr-pending-approval",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export type Report = {
  status: ReportStatus;
  issue: string | undefined;
  branch: string | undefined;
  pr: string | undefined;
  checkOutput: string | undefined;
};

export type Finding = { severity: "error" | "warn"; message: string };

const KEYS = ["STATUS", "ISSUE", "BRANCH", "PR", "BLOCKER", "CHECK_OUTPUT"] as const;

/** `n/a`, `none`, `none (…)` and empty all mean "the report claims nothing here". */
function claimed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().replace(/^`|`$/g, "");
  if (v === "" || /^n\/a$/i.test(v) || /^none\b/i.test(v)) return undefined;
  return v;
}

/**
 * Reads the sentinel lines of the report's `Output` block. The first occurrence of each
 * key wins, so prose quoting a key further down can't override the real field. A report
 * with no valid `STATUS:` is not a report at all (the empty-placeholder failure) and is
 * returned as a finding rather than a half-filled `Report`.
 */
export function parseReport(text: string): { report: Report } | { error: Finding } {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Z_]+):\s?(.*)$/.exec(line);
    if (!m || !(KEYS as readonly string[]).includes(m[1]!) || fields.has(m[1]!)) continue;
    fields.set(m[1]!, m[2]!.trim());
  }

  const status = fields.get("STATUS");
  if (status === undefined) {
    return { error: { severity: "error", message: "no STATUS: line — this is not an implementer report (empty or placeholder output?)" } };
  }
  if (!(REPORT_STATUSES as readonly string[]).includes(status)) {
    return {
      error: { severity: "error", message: `STATUS '${status}' is not one of ${REPORT_STATUSES.join(", ")}` },
    };
  }

  return {
    report: {
      status: status as ReportStatus,
      issue: claimed(fields.get("ISSUE")),
      branch: claimed(fields.get("BRANCH")),
      pr: claimed(fields.get("PR")),
      checkOutput: claimed(fields.get("CHECK_OUTPUT")),
    },
  };
}

export type PrLookup =
  | { kind: "found"; headRefName: string; state: string }
  | { kind: "missing" }
  | { kind: "unknown"; reason: string };

export type Probes = {
  branchExists(branch: string): Promise<boolean>;
  prView(pr: string): Promise<PrLookup>;
  /** Uncommitted paths in the primary checkout (not the worktree). */
  dirtyFiles(): Promise<string[]>;
  /** Paths the branch changes relative to the default branch. */
  branchFiles(branch: string): Promise<string[]>;
  /** `undefined` when no local ticket file matches the report's ISSUE. */
  ticketStatus(issue: string): Promise<StatusRole | undefined>;
};

/**
 * Where the implementer's own flow leaves the ticket's local `status` for each outcome.
 * `blocked-github-unavailable` is absent on purpose: that path says to leave whatever
 * status was last truthfully set, so there is nothing fixed to compare against.
 */
const EXPECTED_TICKET_STATUS: Partial<Record<ReportStatus, StatusRole[]>> = {
  "pr-opened-for-review": ["review", "readyToMerge"],
  "in-progress-blocked": ["blocked"],
  // Verification-only path: a reviewer `approve` goes straight to `done`; a disagreement
  // means a code change after all, which is reported under a different STATUS.
  "verified-no-changes-needed": ["done"],
  "implemented-pending-github": ["inProgress"],
  "adr-pending-approval": ["inProgress"],
};

const NEEDS_BRANCH: ReportStatus[] = ["pr-opened-for-review", "implemented-pending-github", "adr-pending-approval"];

export async function verifyReport(report: Report, probes: Probes): Promise<Finding[]> {
  const findings: Finding[] = [];
  const error = (message: string) => findings.push({ severity: "error", message });
  const warn = (message: string) => findings.push({ severity: "warn", message });

  if (!report.issue) error("ISSUE: is empty — every report names the ticket it was run on");

  if (report.branch) {
    if (!(await probes.branchExists(report.branch))) {
      error(`BRANCH '${report.branch}' does not exist locally or on origin`);
    }
  } else if (NEEDS_BRANCH.includes(report.status)) {
    error(`STATUS ${report.status} implies a branch, but BRANCH: claims none`);
  }

  if (report.status === "pr-opened-for-review" && !report.pr) {
    error("STATUS pr-opened-for-review, but PR: claims no pull request");
  }
  if (report.pr) {
    const pr = await probes.prView(report.pr);
    if (pr.kind === "missing") {
      error(`PR '${report.pr}' does not resolve to a pull request`);
    } else if (pr.kind === "unknown") {
      warn(`could not look up PR '${report.pr}': ${pr.reason}`);
    } else {
      if (report.branch && pr.headRefName !== report.branch) {
        error(`PR '${report.pr}' is for branch '${pr.headRefName}', not the reported BRANCH '${report.branch}'`);
      }
      if (pr.state === "CLOSED") error(`PR '${report.pr}' is closed without being merged`);
    }
  }

  if (report.status === "pr-opened-for-review" && !report.checkOutput) {
    error("STATUS pr-opened-for-review, but CHECK_OUTPUT: is empty — a PR was opened without a recorded check run");
  }

  if (report.issue) {
    const expected = EXPECTED_TICKET_STATUS[report.status];
    const actual = await probes.ticketStatus(report.issue);
    if (actual === undefined) {
      warn(`no local ticket file found for ISSUE ${report.issue} — its status could not be checked`);
    } else if (expected && !expected.includes(actual)) {
      error(`ticket for ISSUE ${report.issue} has status '${actual}', expected ${expected.join(" or ")} after ${report.status}`);
    }
  }

  const dirty = await probes.dirtyFiles();
  if (dirty.length > 0) {
    const onBranch = report.branch ? new Set(await probes.branchFiles(report.branch)) : new Set<string>();
    const leaked = dirty.filter((p) => onBranch.has(p));
    const other = dirty.filter((p) => !onBranch.has(p));
    if (leaked.length > 0) {
      error(`primary checkout has uncommitted changes to files this branch also changes (written outside the worktree?): ${leaked.join(", ")}`);
    }
    if (other.length > 0) {
      warn(`primary checkout has other uncommitted changes (may be the human's own): ${other.join(", ")}`);
    }
  }

  return findings;
}
