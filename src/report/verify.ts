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
  ticket: string | undefined;
  /**
   * Set when the ticket came from a pre-ADR-0015 `ISSUE:` line: its value is a GitHub
   * issue number, which names no ticket file, so it must not be looked up as one.
   */
  legacyIssue?: string;
  branch: string | undefined;
  pr: string | undefined;
  checkOutput: string | undefined;
  /**
   * The implementer's own claim about the PR's CI state (ticket 0054) — informational
   * only; `verifyReport` never trusts it, it re-queries `probes.prChecks` itself the same
   * way it re-queries `prView` instead of trusting `PR:`.
   */
  ci: "pass" | "fail" | "pending" | "none" | undefined;
};

export type Finding = { severity: "error" | "warn"; message: string };

/** `ISSUE` is the pre-ADR-0015 name of `TICKET`, still read from older installed prompts. */
const KEYS = ["STATUS", "TICKET", "ISSUE", "BRANCH", "PR", "BLOCKER", "CHECK_OUTPUT", "CI"] as const;

const CI_VALUES = ["pass", "fail", "pending", "none"] as const;

/** `CI:` names a fixed enum; anything else (missing, freeform prose) parses as "no claim". */
function ciClaim(value: string | undefined): Report["ci"] {
  if (value === undefined) return undefined;
  const v = unwrap(value).toLowerCase();
  return (CI_VALUES as readonly string[]).includes(v) ? (v as Report["ci"]) : undefined;
}

/** Strips the wrapping an agent tends to add around a value: quotes, backticks, bold. */
function unwrap(value: string): string {
  return value.trim().replace(/^(\*\*|["'`])+|(\*\*|["'`])+$/g, "").trim();
}

/** `n/a`, `none`, either with a trailing explanation, and empty all mean "no claim". */
function claimed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = unwrap(value);
  if (v === "" || /^n\/a\b/i.test(v) || /^none\b/i.test(v)) return undefined;
  return v;
}

/**
 * A sentinel line, tolerating the markdown an agent may wrap the block in: a list marker
 * (`- STATUS: …`), a quote marker, or bold/backticked keys (`**STATUS:** …`).
 */
const SENTINEL = /^\s*(?:[-*>]\s+)?(?:\*\*|`)?([A-Z_]+):(?:\*\*|`)?\s?(.*)$/;

/**
 * Reads the sentinel lines of the report's `Output` block. The first occurrence of each
 * key wins, so prose quoting a key further down can't override the real field. A report
 * with no valid `STATUS:` is not a report at all (the empty-placeholder failure) and is
 * returned as a finding rather than a half-filled `Report`.
 */
export function parseReport(text: string): { report: Report } | { error: Finding } {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = SENTINEL.exec(line);
    if (!m || !(KEYS as readonly string[]).includes(m[1]!) || fields.has(m[1]!)) continue;
    fields.set(m[1]!, m[2]!.trim());
  }

  const rawStatus = fields.get("STATUS");
  const status = rawStatus === undefined ? undefined : unwrap(rawStatus);
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
      ...ticketField(fields),
      branch: claimed(fields.get("BRANCH")),
      pr: claimed(fields.get("PR")),
      checkOutput: claimed(fields.get("CHECK_OUTPUT")),
      ci: ciClaim(fields.get("CI")),
    },
  };
}

function ticketField(fields: Map<string, string>): Pick<Report, "ticket" | "legacyIssue"> {
  if (fields.has("TICKET")) return { ticket: claimed(fields.get("TICKET")) };
  // The old prompt only ever wrote a GitHub issue number under ISSUE, `#` or not: looking
  // it up as a ticket number would match an unrelated ticket.
  const issue = claimed(fields.get("ISSUE"));
  return issue ? { ticket: issue, legacyIssue: issue } : { ticket: undefined };
}

export type PrLookup =
  | { kind: "found"; headRefName: string; state: string }
  | { kind: "missing" }
  | { kind: "unknown"; reason: string };

/**
 * The PR's CI check state (ticket 0054), collapsed to what `readyToMerge` actually cares
 * about: any failing check beats everything else, then any still running, then a clean
 * pass; `none` means the repo has no checks configured at all — not itself a problem.
 */
export type PrChecksLookup =
  | { kind: "pass" }
  | { kind: "fail" }
  | { kind: "pending" }
  | { kind: "none" }
  | { kind: "unknown"; reason: string };

/**
 * Whether the PR's head ref was ever force-pushed (ticket 0056 — reviewer must never ask
 * for a rewrite of already-pushed history, and `verify-report`/`doctor` should surface it
 * as a warning when it happens anyway, e.g. via a `head_ref_force_pushed` timeline event).
 */
export type ForcePushLookup = { kind: "yes"; count: number } | { kind: "no" } | { kind: "unknown"; reason: string };

export type Probes = {
  branchExists(branch: string): Promise<boolean>;
  prView(pr: string): Promise<PrLookup>;
  prChecks(pr: string): Promise<PrChecksLookup>;
  /** Uncommitted paths in the primary checkout (not the worktree). */
  dirtyFiles(): Promise<string[]>;
  /** Paths changed by commits only this branch has; `null` when git couldn't tell. */
  branchFiles(branch: string): Promise<string[] | null>;
  /**
   * The ticket's status in the primary checkout — the only copy agents write (ADR 0015).
   * A copy committed on the branch is deliberately ignored: no agent writes there, so it
   * only ever holds a stale status that could make a false report pass. `undefined` when
   * no ticket file matches the TICKET.
   */
  ticketStatus(ticket: string): Promise<StatusRole | undefined>;
  /** Whether the PR's head ref has ever been force-pushed. */
  forcePushed(pr: string): Promise<ForcePushLookup>;
};

/**
 * Where the implementer's own flow leaves the ticket's local `status` for each outcome.
 * `blocked-github-unavailable` is absent on purpose: that path says to leave whatever
 * status was last truthfully set, so there is nothing fixed to compare against.
 */
const EXPECTED_TICKET_STATUS: Partial<Record<ReportStatus, StatusRole[]>> = {
  "pr-opened-for-review": ["review", "readyToMerge"],
  // `triage` runs before the report and may resolve the blocker, moving the ticket back.
  "in-progress-blocked": ["blocked", "planned"],
  // Verification-only path: a reviewer `approve` goes straight to `done`; a disagreement
  // means a code change after all, which is reported under a different STATUS.
  "verified-no-changes-needed": ["done"],
  "implemented-pending-github": ["inProgress"],
  "adr-pending-approval": ["inProgress"],
};

const NEEDS_BRANCH: ReportStatus[] = ["pr-opened-for-review", "implemented-pending-github", "adr-pending-approval"];

/** Matches `owner/repo` out of a GitHub pull request URL. */
const PR_URL = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/\d+/i;

export type VerifyOptions = {
  /** `owner/repo` the PR must belong to; a same-named branch on a fork proves nothing. */
  repo?: string;
};

export async function verifyReport(report: Report, probes: Probes, options: VerifyOptions = {}): Promise<Finding[]> {
  const findings: Finding[] = [];
  const error = (message: string) => findings.push({ severity: "error", message });
  const warn = (message: string) => findings.push({ severity: "warn", message });

  if (!report.ticket) error("TICKET: is empty — every report names the ticket it was run on");

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
  const prRepo = report.pr ? PR_URL.exec(report.pr)?.[1] : undefined;
  if (prRepo && options.repo && prRepo.toLowerCase() !== options.repo.toLowerCase()) {
    error(`PR '${report.pr}' is on ${prRepo}, not on this project's repo ${options.repo}`);
  } else if (report.pr) {
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

      // Ticket 0056: a force-pushed head ref means already-public history was rewritten —
      // never itself an error (the human may have done it, or approved an exception), but
      // always worth surfacing since `implementer`/`reviewer` are never supposed to cause it.
      // Only asked of a PR that resolved: a missing/unreachable one already has its finding.
      const forcePush = await probes.forcePushed(report.pr);
      if (forcePush.kind === "yes") {
        warn(`PR '${report.pr}' head ref was force-pushed ${forcePush.count} time(s) — already-pushed history was rewritten`);
      } else if (forcePush.kind === "unknown") {
        warn(`could not check whether PR '${report.pr}' was force-pushed: ${forcePush.reason}`);
      }
    }
  }

  if (report.status === "pr-opened-for-review" && !report.checkOutput) {
    error("STATUS pr-opened-for-review, but CHECK_OUTPUT: is empty — a PR was opened without a recorded check run");
  }

  if (report.legacyIssue) {
    warn(
      `ISSUE ${report.legacyIssue} is a GitHub issue number from an older installed prompt — tickets are named by id now ` +
        "(ADR 0015), so its status could not be checked; reinstall the packs to get TICKET: lines",
    );
  } else if (report.ticket) {
    const expected = EXPECTED_TICKET_STATUS[report.status];
    const actual = await probes.ticketStatus(report.ticket);
    if (actual === undefined) {
      warn(`no ticket file found for TICKET ${report.ticket} — its status could not be checked`);
    } else if (expected && !expected.includes(actual)) {
      error(`ticket ${report.ticket} has status '${actual}', expected ${expected.join(" or ")} after ${report.status}`);
    }

    // A ticket only reaches readyToMerge through this same report's PR — so its CI has to
    // have actually gone green, not just have been claimed green (ticket 0054, PR #93).
    if (actual === "readyToMerge" && report.pr) {
      const checks = await probes.prChecks(report.pr);
      if (checks.kind === "fail") {
        error(`PR '${report.pr}' has a failing check, but the ticket is readyToMerge`);
      } else if (checks.kind === "pending") {
        warn(`PR '${report.pr}' still has checks running while the ticket is readyToMerge`);
      } else if (checks.kind === "unknown") {
        warn(`could not check CI status for PR '${report.pr}': ${checks.reason} — unverified`);
      }
      // "pass" and "none" (no CI configured on the repo) need no finding.
    }
  }

  const dirty = await probes.dirtyFiles();
  if (dirty.length > 0) {
    const files = report.branch ? await probes.branchFiles(report.branch) : [];
    if (files === null) warn(`could not list the files BRANCH '${report.branch}' changes — leak check is incomplete`);
    const onBranch = new Set(files ?? []);
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
