import { expect, test } from "bun:test";
import { formatJournalBlock, latestJournalEntry, parseJournalEntries } from "../src/report/journal.ts";

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
