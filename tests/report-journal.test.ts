import { expect, test } from "bun:test";
import { formatJournalBlock, isValidCommitValue, isValidPrValue, latestJournalEntry, parseJournalEntries } from "../src/report/journal.ts";

test("no journal-shaped block returns undefined", () => {
  expect(latestJournalEntry("Just some prose, no blocks at all.")).toBeUndefined();
});

test("a progress-journal block is parsed", () => {
  const body = `
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
  const entry = latestJournalEntry(body);
  expect(entry).toEqual({
    step: "step 4: implement",
    worktree: "../worktrees/0034",
    branch: "feat/x/0034",
    base: "main",
    commit: "abc123",
    checks: "bun run check: pass",
    pr: undefined,
  });
});

test("a resume-manifest block (ADR 0008 gate) is read as the same journal shape", () => {
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
  const entry = latestJournalEntry(body);
  expect(entry?.step).toBe("adr-pending-approval");
  expect(entry?.adrPath).toBe("docs/decisions/0009-x.md");
  expect(entry?.adrPosted).toBe(true);
  expect(entry?.commit).toBe("none");
});

test("the latest of several journal notes wins", () => {
  const body = `
\`\`\`progress-journal
step: step 3: worktree created
branch: feat/x/0034
\`\`\`

Some notes in between.

\`\`\`progress-journal
step: step 4: implement
branch: feat/x/0034
commit: def456
\`\`\`
`;
  expect(parseJournalEntries(body)).toHaveLength(2);
  expect(latestJournalEntry(body)?.step).toBe("step 4: implement");
  expect(latestJournalEntry(body)?.commit).toBe("def456");
});

test("formatJournalBlock only prints set fields", () => {
  const block = formatJournalBlock({ step: "step 3: worktree created", branch: "feat/x/0034" });
  expect(block).toBe("```progress-journal\nstep: step 3: worktree created\nbranch: feat/x/0034\n```");
  expect(latestJournalEntry(block)?.step).toBe("step 3: worktree created");
});

test("a progress-journal block with CRLF line endings parses the same as LF", () => {
  const body = [
    "### 2026-09-28 — implementer: progress",
    "",
    "```progress-journal",
    "step: step 4: implement",
    "branch: feat/x/0034",
    "commit: abc123",
    "```",
    "",
  ].join("\r\n");
  const entry = latestJournalEntry(body);
  expect(entry?.step).toBe("step 4: implement");
  expect(entry?.branch).toBe("feat/x/0034");
  expect(entry?.commit).toBe("abc123");
});

test("an unclosed progress-journal block throws instead of swallowing the next block", () => {
  const body = `
\`\`\`progress-journal
step: step 4: implement
branch: feat/x/0034

\`\`\`progress-journal
step: step 7: PR opened
branch: feat/x/0034
pr: 42
\`\`\`
`;
  expect(() => parseJournalEntries(body)).toThrow(/unclosed/);
});

test("an invalid commit value is dropped rather than kept for a probe to consume", () => {
  const body = `
\`\`\`progress-journal
step: step 4: implement
branch: feat/x/0034
commit: rm -rf /; echo pwned
\`\`\`
`;
  expect(latestJournalEntry(body)?.commit).toBeUndefined();
});

test("an invalid pr value is dropped rather than kept for a probe to consume", () => {
  const body = `
\`\`\`progress-journal
step: step 7: PR opened
branch: feat/x/0034
pr: $(rm -rf /)
\`\`\`
`;
  expect(latestJournalEntry(body)?.pr).toBeUndefined();
});

test("isValidCommitValue accepts sha-like values and 'none', rejects everything else", () => {
  expect(isValidCommitValue("abc1234")).toBe(true);
  expect(isValidCommitValue("none")).toBe(true);
  expect(isValidCommitValue("not-a-sha")).toBe(false);
  expect(isValidCommitValue("rm -rf /")).toBe(false);
});

test("isValidPrValue accepts bare numbers, #-prefixed numbers and URLs, rejects everything else", () => {
  expect(isValidPrValue("42")).toBe(true);
  expect(isValidPrValue("#42")).toBe(true);
  expect(isValidPrValue("https://github.com/o/r/pull/42")).toBe(true);
  expect(isValidPrValue("$(rm -rf /)")).toBe(false);
});
