import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPendingAdrs } from "../../src/decisions/pending.ts";
import type { Ticket } from "../../src/tickets/spec.ts";

const dirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-adr-pending-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function ticket(id: string, body: string): Ticket {
  return {
    schemaVersion: 2,
    id,
    title: id,
    label: "feature",
    status: "inProgress",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path: `docs/tickets/07-resilience/${id}.md`,
    body,
    extraFrontmatter: {},
  } as Ticket;
}

function draftBody(adrNumber: string, adrPath: string, branch = "feat/x/0047"): string {
  return `
## ADR à valider : ${adrNumber}

Draft awaiting human approval — not committed.

# ${adrNumber}. Some decision

Status: proposed

## Context

Some context.

\`\`\`resume-manifest
worktree: ../worktrees/0047
branch: ${branch}
commit: none
adr_path: ${adrPath}
board_status: In Progress
checks_passed: not yet run
adr_posted: true
\`\`\`
`;
}

test("no journal-shaped block at all: no pending ADR", async () => {
  const root = await tmpRoot();
  const t = ticket("0047-feat-x", "Just some prose, no blocks at all.\n");
  expect(await listPendingAdrs(root, [t])).toEqual([]);
});

test("a resume-manifest naming an ADR file that doesn't exist yet is pending, with full text", async () => {
  const root = await tmpRoot();
  const body = draftBody("0018", "docs/decisions/0018-example.md");
  const t = ticket("0047-feat-x", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    ticketId: "0047-feat-x",
    ticketPath: t.path,
    adrPath: "docs/decisions/0018-example.md",
    adrNumber: "0018",
    branch: "feat/x/0047",
    worktree: "../worktrees/0047",
  });
  expect(pending[0]!.text).toContain("Some decision");
  expect(pending[0]!.text).toContain("Some context.");
});

test("once the ADR file is actually committed, the ticket drops out of the pending list", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(root, "docs/decisions/0018-example.md"), "# 0018. Some decision\n\nStatus: accepted\n");
  const body = draftBody("0018", "docs/decisions/0018-example.md");
  const t = ticket("0047-feat-x", body);

  expect(await listPendingAdrs(root, [t])).toEqual([]);
});

test("a ticket resumed through the gate twice only reports its latest adr_path", async () => {
  const root = await tmpRoot();
  const body = draftBody("0018", "docs/decisions/0018-example-stale.md") + draftBody("0019", "docs/decisions/0019-example.md", "feat/x/0047");
  const t = ticket("0047-feat-x", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.adrPath).toBe("docs/decisions/0019-example.md");
});

test("a legacy ticket with no dedicated '## ADR à valider' section still reports pending, with text null", async () => {
  const root = await tmpRoot();
  const body = `
### 2026-09-28 — implementer: ADR draft

Draft awaiting human approval — not committed.

\`\`\`resume-manifest
worktree: ../worktrees/0009
branch: feat/x/0009
commit: none
adr_path: docs/decisions/0009-legacy.md
board_status: In Progress
checks_passed: not yet run
adr_posted: true
\`\`\`
`;
  const t = ticket("0009-feat-legacy", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.text).toBeNull();
});

test("once implementer resumes past the gate (a later journal entry with no adr_path), the ticket is no longer pending — even though the ADR file isn't on `root` yet (it's on the ticket's own branch, not committed here)", async () => {
  const root = await tmpRoot();
  const body =
    draftBody("0018", "docs/decisions/0018-example.md") +
    `
\`\`\`progress-journal
step: step 7: PR opened
worktree: ../worktrees/0047
branch: feat/x/0047
commit: abc123
checks: bun run check: pass
pr: https://github.com/o/r/pull/1
\`\`\`
`;
  const t = ticket("0047-feat-x", body);

  expect(await listPendingAdrs(root, [t])).toEqual([]);
});

test("an indented resume-manifest fence (nested inside a numbered list, per implementer's template) is still matched for its text", async () => {
  const root = await tmpRoot();
  const body = `
## ADR à valider : 0018

Draft awaiting human approval — not committed.

# 0018. Some decision

1. Some step.

   \`\`\`resume-manifest
   worktree: ../worktrees/0047
   branch: feat/x/0047
   commit: none
   adr_path: docs/decisions/0018-example.md
   board_status: In Progress
   checks_passed: not yet run
   adr_posted: true
   \`\`\`
`;
  const t = ticket("0047-feat-x", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.text).toContain("Some decision");
});

test("a heading with trailing text after the ADR number is still matched", async () => {
  const root = await tmpRoot();
  const body = draftBody("0018", "docs/decisions/0018-example.md").replace(
    "## ADR à valider : 0018",
    "## ADR à valider : 0018 — Use X",
  );
  const t = ticket("0047-feat-x", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.text).toContain("Some decision");
});

test("an NFD-encoded 'à' in the heading is still matched (NFC-normalized before matching)", async () => {
  const root = await tmpRoot();
  const nfdA = "à"; // decomposed "à"
  const body = draftBody("0018", "docs/decisions/0018-example.md").replace("à", nfdA);
  const t = ticket("0047-feat-x", body);

  const pending = await listPendingAdrs(root, [t]);
  expect(pending).toHaveLength(1);
  expect(pending[0]!.text).toContain("Some decision");
});
