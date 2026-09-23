import { expect, test } from "bun:test";
import { parseReport, verifyReport, type Probes, type Report, type VerifyOptions } from "../src/report/verify.ts";

const GOOD = `Some prose before the block.

STATUS: pr-opened-for-review
TICKET: 0045
BRANCH: fix/verify/issue-45
PR: https://github.com/o/r/pull/7
BLOCKER: none
CHECK_OUTPUT: tsc --noEmit clean, 156 pass / 0 fail
`;

function parsed(text: string): Report {
  const r = parseReport(text);
  if ("error" in r) throw new Error(r.error.message);
  return r.report;
}

/** A world in which every claim in GOOD is true; each test breaks one thing. */
function probes(overrides: Partial<Probes> = {}): Probes {
  return {
    branchExists: async (b) => b === "fix/verify/issue-45",
    prView: async () => ({ kind: "found", headRefName: "fix/verify/issue-45", state: "OPEN" }),
    dirtyFiles: async () => [],
    branchFiles: async () => ["src/a.ts"],
    ticketStatuses: async () => ["review"],
    ...overrides,
  };
}

const errors = async (report: Report, p: Probes, options?: VerifyOptions) =>
  (await verifyReport(report, p, options)).filter((f) => f.severity === "error").map((f) => f.message);

test("a truthful report produces no findings", async () => {
  expect(await verifyReport(parsed(GOOD), probes())).toEqual([]);
});

test("a placeholder with no STATUS line is rejected as not a report", () => {
  const r = parseReport("Placeholder — not finished yet, waiting on reviewer's verdict.");
  expect("error" in r && r.error.message).toContain("no STATUS: line");
});

test("an unknown STATUS value is rejected", () => {
  const r = parseReport("STATUS: done-probably\nTICKET: 0001");
  expect("error" in r && r.error.message).toContain("is not one of");
});

test("the first occurrence of a key wins over prose quoting it later", () => {
  const r = parsed(`${GOOD}\nAs the reviewer said, STATUS: in-progress-blocked`);
  expect(r.status).toBe("pr-opened-for-review");
});

test("n/a and none (...) values count as no claim", () => {
  const r = parsed("STATUS: in-progress-blocked\nTICKET: 0003\nBRANCH: n/a\nPR: none (blocked before implementation)\nCHECK_OUTPUT: n/a");
  expect([r.branch, r.pr, r.checkOutput]).toEqual([undefined, undefined, undefined]);
});

test("a branch that doesn't exist is an error", async () => {
  expect(await errors(parsed(GOOD), probes({ branchExists: async () => false }))).toEqual([
    "BRANCH 'fix/verify/issue-45' does not exist locally or on origin",
  ]);
});

test("a PR that doesn't resolve is an error", async () => {
  const found = await errors(parsed(GOOD), probes({ prView: async () => ({ kind: "missing" }) }));
  expect(found).toEqual(["PR 'https://github.com/o/r/pull/7' does not resolve to a pull request"]);
});

test("a PR for a different branch is an error", async () => {
  const found = await errors(
    parsed(GOOD),
    probes({ prView: async () => ({ kind: "found", headRefName: "other", state: "OPEN" }) }),
  );
  expect(found[0]).toContain("is for branch 'other'");
});

test("a closed, unmerged PR is an error; a merged one is not", async () => {
  const closed = probes({ prView: async () => ({ kind: "found", headRefName: "fix/verify/issue-45", state: "CLOSED" }) });
  const merged = probes({ prView: async () => ({ kind: "found", headRefName: "fix/verify/issue-45", state: "MERGED" }) });
  expect((await errors(parsed(GOOD), closed))[0]).toContain("closed without being merged");
  expect(await errors(parsed(GOOD), merged)).toEqual([]);
});

test("an unreachable gh is a warning, not an error", async () => {
  const findings = await verifyReport(parsed(GOOD), probes({ prView: async () => ({ kind: "unknown", reason: "offline" }) }));
  expect(findings).toEqual([{ severity: "warn", message: "could not look up PR 'https://github.com/o/r/pull/7': offline" }]);
});

test("pr-opened-for-review without a PR or a check run is an error", async () => {
  const r = parsed("STATUS: pr-opened-for-review\nTICKET: 0045\nBRANCH: fix/verify/issue-45\nPR: none\nCHECK_OUTPUT: n/a");
  expect(await errors(r, probes())).toEqual([
    "STATUS pr-opened-for-review, but PR: claims no pull request",
    "STATUS pr-opened-for-review, but CHECK_OUTPUT: is empty — a PR was opened without a recorded check run",
  ]);
});

test("a status that implies a branch requires one", async () => {
  const r = parsed("STATUS: implemented-pending-github\nTICKET: 0045\nBRANCH: n/a\nPR: none (pending GitHub)");
  expect(await errors(r, probes({ ticketStatuses: async () => ["inProgress"] }))).toEqual([
    "STATUS implemented-pending-github implies a branch, but BRANCH: claims none",
  ]);
});

test("a missing TICKET is an error", async () => {
  const r = parsed("STATUS: in-progress-blocked\nTICKET: \nBRANCH: n/a");
  expect(await errors(r, probes())).toEqual(["TICKET: is empty — every report names the ticket it was run on"]);
});

test("a ticket status that contradicts the reported outcome is an error", async () => {
  expect(await errors(parsed(GOOD), probes({ ticketStatuses: async () => ["inProgress"] }))).toEqual([
    "ticket 0045 has status 'inProgress', expected review or readyToMerge after pr-opened-for-review",
  ]);
});

test("verified-no-changes-needed expects the ticket in done", async () => {
  const r = parsed("STATUS: verified-no-changes-needed\nTICKET: 0045\nBRANCH: n/a\nPR: none (verification-only)");
  expect(await errors(r, probes({ ticketStatuses: async () => ["review"] }))).toEqual([
    "ticket 0045 has status 'review', expected done after verified-no-changes-needed",
  ]);
});

test("in-progress-blocked accepts a ticket triage already moved back to planned", async () => {
  const r = parsed("STATUS: in-progress-blocked\nTICKET: 0045\nBRANCH: n/a");
  expect(await errors(r, probes({ ticketStatuses: async () => ["planned"] }))).toEqual([]);
});

test("the ticket passes when any of its copies has the expected status", async () => {
  // Step 2 leaves `inProgress` in the primary checkout; step 10 commits `review` on the branch.
  expect(await errors(parsed(GOOD), probes({ ticketStatuses: async () => ["inProgress", "review"] }))).toEqual([]);
});

test("blocked-github-unavailable has no expected ticket status", async () => {
  const r = parsed("STATUS: blocked-github-unavailable\nTICKET: 0045\nBRANCH: n/a");
  expect(await errors(r, probes({ ticketStatuses: async () => ["planned"] }))).toEqual([]);
});

test("a ticket with no local file is only a warning", async () => {
  const findings = await verifyReport(parsed(GOOD), probes({ ticketStatuses: async () => [] }));
  expect(findings).toEqual([
    { severity: "warn", message: "no ticket file found for TICKET 0045 — its status could not be checked" },
  ]);
});

test("a PR on another repo is an error, whatever its branch", async () => {
  const found = await errors(parsed(GOOD), probes(), { repo: "someone/else" });
  expect(found).toEqual(["PR 'https://github.com/o/r/pull/7' is on o/r, not on this project's repo someone/else"]);
  expect(await errors(parsed(GOOD), probes(), { repo: "O/R" })).toEqual([]);
});

test("CRLF line endings and markdown wrapping still parse", () => {
  const r = parsed("- **STATUS:** `pr-opened-for-review`\r\n- TICKET: 0045\r\n* `BRANCH:` fix/verify/issue-45\r\n");
  expect([r.status, r.ticket, r.branch]).toEqual(["pr-opened-for-review", "0045", "fix/verify/issue-45"]);
});

test("quoted or annotated n/a counts as no claim", () => {
  const r = parsed('STATUS: in-progress-blocked\nTICKET: 0003\nBRANCH: "n/a"\nCHECK_OUTPUT: n/a (never got that far)');
  expect([r.branch, r.checkOutput]).toEqual([undefined, undefined]);
});

test("an unknown branch file list is a warning, and nothing counts as leaked", async () => {
  const findings = await verifyReport(
    parsed(GOOD),
    probes({ dirtyFiles: async () => ["src/a.ts"], branchFiles: async () => null }),
  );
  expect(findings.map((f) => f.severity)).toEqual(["warn", "warn"]);
  expect(findings[0]!.message).toContain("leak check is incomplete");
});

test("branch files left dirty in the primary checkout are an error; unrelated dirt is a warning", async () => {
  const findings = await verifyReport(parsed(GOOD), probes({ dirtyFiles: async () => ["src/a.ts", "notes.txt"] }));
  expect(findings).toEqual([
    {
      severity: "error",
      message: "primary checkout has uncommitted changes to files this branch also changes (written outside the worktree?): src/a.ts",
    },
    { severity: "warn", message: "primary checkout has other uncommitted changes (may be the human's own): notes.txt" },
  ]);
});

test("an ISSUE: #n from an older prompt is a GitHub issue: warned about, never looked up as a ticket", async () => {
  const r = parsed("STATUS: in-progress-blocked\nISSUE: #45\nBRANCH: n/a");
  let lookedUp = false;
  const findings = await verifyReport(r, probes({ ticketStatuses: async () => ((lookedUp = true), ["planned"]) }));
  expect(lookedUp).toBe(false);
  expect(findings).toEqual([{ severity: "warn", message: expect.stringContaining("ISSUE #45 is a GitHub issue number") }]);
});

test("a report from an older prompt still names its ticket under ISSUE", () => {
  expect(parsed("STATUS: in-progress-blocked\nISSUE: 0045\nBRANCH: n/a").ticket).toBe("0045");
  expect(parsed("STATUS: in-progress-blocked\nTICKET: 0030\nISSUE: 0045").ticket).toBe("0030");
});
