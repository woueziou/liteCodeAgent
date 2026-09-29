import { expect, test } from "bun:test";
import { resumeState, type ResumeProbes } from "../src/resume.ts";

const JOURNAL_BODY = `
### 2026-09-28 — implementer: progress

\`\`\`progress-journal
step: step 4: implement
worktree: ../worktrees/0034
branch: feat/x/0034
base: main
commit: abc123
checks: bun run check: pass
\`\`\`
`;

/** A world in which every claim in JOURNAL_BODY is true; each test breaks one thing. */
function probes(overrides: Partial<ResumeProbes> = {}): ResumeProbes {
  return {
    branchExists: async (b) => b === "feat/x/0034",
    prView: async () => ({ kind: "missing" }),
    prChecks: async () => ({ kind: "none" }),
    dirtyFiles: async () => [],
    branchFiles: async () => [],
    ticketStatus: async () => "inProgress",
    worktreeExists: async (p) => p === "../worktrees/0034",
    commitInBranch: async (b, c) => b === "feat/x/0034" && c === "abc123",
    headCommit: async (b) => (b === "feat/x/0034" ? "abc123" : null),
    openPrForBranch: async () => null,
    ...overrides,
  };
}

test("a ticket with no journal note reports no-journal", async () => {
  const result = await resumeState("Just prose, no journal block.", probes());
  expect(result.kind).toBe("no-journal");
});

test("a nominal resume: everything checks out, no findings, points at the last step", async () => {
  const result = await resumeState(JOURNAL_BODY, probes());
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings).toEqual([]);
  expect(result.resumeAt).toContain("step 4: implement");
  expect(result.resumeAt).toContain("abc123");
});

test("a missing worktree is a warning, not an error — it can be recreated", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ worktreeExists: async () => false }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings).toEqual([
    { severity: "warn", message: expect.stringContaining("no longer exists") },
  ]);
  expect(result.findings.some((f) => f.severity === "error")).toBe(false);
});

test("journal inconsistent with git: branch gone is an error and blocks resuming", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ branchExists: async () => false }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings.some((f) => f.severity === "error" && f.message.includes("does not exist"))).toBe(true);
  expect(result.resumeAt).toContain("diverges from the journal");
});

test("journal inconsistent with git: commit not reachable on branch is an error", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ commitInBranch: async () => false }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings.some((f) => f.severity === "error" && f.message.includes("not reachable"))).toBe(true);
});

test("an ADR-gate journal (resume-manifest) points at the ADR approval step", async () => {
  const body = `
\`\`\`resume-manifest
worktree: ../worktrees/0009
branch: feat/x/0009
commit: none
adr_path: docs/decisions/0009-x.md
board_status: In Progress
checks_passed: not yet run
adr_posted: true
\`\`\`
`;
  const result = await resumeState(
    body,
    probes({ branchExists: async (b) => b === "feat/x/0009", worktreeExists: async (p) => p === "../worktrees/0009" }),
  );
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.resumeAt).toContain("ADR draft approval gate");
  expect(result.resumeAt).toContain("docs/decisions/0009-x.md");
});

test("a branch that moved past the journal's commit is flagged as a stale journal", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ headCommit: async () => "def456" }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings.some((f) => f.severity === "warn" && f.message.includes("journal is behind the repo"))).toBe(true);
});

test("an abbreviated (or differently-cased) commit that's still a prefix of the tip is not flagged stale", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ headCommit: async () => "ABC123def456" }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings.some((f) => f.message.includes("journal is behind the repo"))).toBe(false);
});

test("an open PR the journal never recorded is flagged as a stale journal", async () => {
  const result = await resumeState(JOURNAL_BODY, probes({ openPrForBranch: async () => "https://github.com/o/r/pull/7" }));
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(
    result.findings.some((f) => f.severity === "warn" && f.message.includes("open PR") && f.message.includes("never recorded")),
  ).toBe(true);
});

test("a PR whose head branch differs from the journal's branch is an error", async () => {
  const bodyWithPr = `
\`\`\`progress-journal
step: step 8: reviewer/bug-hunter invoked
branch: feat/x/0034
pr: https://github.com/o/r/pull/9
\`\`\`
`;
  const result = await resumeState(
    bodyWithPr,
    probes({ prView: async () => ({ kind: "found", headRefName: "some-other-branch", state: "OPEN" }) }),
  );
  if (result.kind !== "resolved") throw new Error("expected resolved");
  expect(result.findings.some((f) => f.severity === "error" && f.message.includes("not the journal's branch"))).toBe(true);
});
