import { expect, test, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoardItems, type BoardItem } from "../src/gh.ts";
import { importedFromOf, mapBoardItem, runImportBoard } from "../src/tickets/import-board.ts";
import { createTicket, listTickets } from "../src/tickets/store.ts";
import { CLARIFICATION_MARKER } from "../src/tickets/spec.ts";

const realBin = process.env.LITECODE_GH_BIN;

async function stubGh(script: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-"));
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\n${script}\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
});

const issueItem: BoardItem = {
  kind: "issue",
  id: "PVTI_1",
  repo: "acme/widgets",
  number: 42,
  title: "Fix the thing",
  body: "## Contexte\nblah\n\n## Critères d'acceptation\nyes\n\n## Plan\ndo it\n\n## Hors périmètre\nn/a\n",
  fields: { status: "In Progress", priority: "high", size: "small" },
};

const draftItem: BoardItem = {
  kind: "draft",
  id: "PVTI_draft_1",
  title: "Some raw idea",
  body: "Just an unstructured note about doing X.",
  fields: {},
};

test("importedFromOf: issue vs draft format", () => {
  expect(importedFromOf(issueItem)).toBe("github:acme/widgets#42");
  expect(importedFromOf(draftItem)).toBe("github-project-item:PVTI_draft_1");
});

test("mapBoardItem: recognized field values map onto local enums, structured body kept as-is", () => {
  const mapped = mapBoardItem(issueItem);
  expect(mapped.status).toBe("inProgress");
  expect(mapped.priority).toBe("high");
  expect(mapped.size).toBe("small");
  expect(mapped.unmapped).toEqual([]);
  expect(mapped.body).not.toContain(CLARIFICATION_MARKER);
  expect(mapped.body).toContain("## Contexte");
  expect(mapped.body).toContain("## Critères d'acceptation");
});

test("mapBoardItem: unknown field value forces backlog + [À CLARIFIER] citing the raw value", () => {
  const item: BoardItem = { ...issueItem, fields: { status: "Triaging", priority: "high", size: "small" } };
  const mapped = mapBoardItem(item);
  expect(mapped.status).toBe("backlog");
  expect(mapped.unmapped).toEqual([{ field: "status", raw: "Triaging" }]);
  expect(mapped.body).toContain(CLARIFICATION_MARKER);
  expect(mapped.body).toContain("Triaging");
});

test("mapBoardItem: unstructured body goes under Contexte, criteria section is the clarification placeholder, no section is empty", () => {
  const mapped = mapBoardItem(draftItem);
  expect(mapped.body).toContain("## Contexte\n\nJust an unstructured note about doing X.");
  expect(mapped.body).toContain(`## Critères d'acceptation\n\n${CLARIFICATION_MARKER} critères à définir`);
  expect(mapped.body).toContain(`## Plan\n\n${CLARIFICATION_MARKER}`);
  expect(mapped.body).toContain(`## Hors périmètre\n\n${CLARIFICATION_MARKER}`);
  for (const section of mapped.body.split(/^## /m).slice(1)) {
    expect(section.split("\n").slice(1).join("\n").trim().length).toBeGreaterThan(0);
  }
});

async function withTmpDir<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "litecode-import-board-"));
  return fn(root);
}

test("runImportBoard: idempotence — an item already imported (exact importedFrom match) is skipped, not overwritten", async () => {
  await withTmpDir(async (root) => {
    const dir = "docs/tickets";
    await createTicket(root, dir, {
      title: "Fix the thing (already here)",
      label: "feature",
      body: "## Contexte\nold\n\n## Critères d'acceptation\nold\n\n## Plan\nold\n\n## Hors périmètre\nold\n",
      importedFrom: importedFromOf(issueItem),
    });
    const summary = await runImportBoard(root, dir, [issueItem], true);
    expect(summary.entries).toEqual([{ outcome: "skipped", importedFrom: "github:acme/widgets#42", reason: expect.any(String) }]);
    const tickets = await listTickets(root, dir);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.body).toContain("old");
  });
});

test("runImportBoard: re-running after an interruption only acts on items not yet imported", async () => {
  await withTmpDir(async (root) => {
    const dir = "docs/tickets";
    const first = await runImportBoard(root, dir, [issueItem, draftItem], true);
    expect(first.entries.every((e) => e.outcome === "imported")).toBe(true);
    const second = await runImportBoard(root, dir, [issueItem, draftItem], true);
    expect(second.entries.every((e) => e.outcome === "skipped")).toBe(true);
    const tickets = await listTickets(root, dir);
    expect(tickets).toHaveLength(2);
  });
});

test("runImportBoard: dry run (apply=false) reports but writes nothing", async () => {
  await withTmpDir(async (root) => {
    const dir = "docs/tickets";
    const summary = await runImportBoard(root, dir, [issueItem], false);
    expect(summary.applied).toBe(false);
    expect(summary.entries[0]!.outcome).toBe("imported");
    const tickets = await listTickets(root, dir);
    expect(tickets).toHaveLength(0);
  });
});

test("runImportBoard: isolation — one item's failure doesn't stop the rest, and is reported with a reason", async () => {
  await withTmpDir(async (root) => {
    const dir = "docs/tickets";
    const { mkdir } = await import("node:fs/promises");
    // `draftItem` ("Some raw idea") is first, so it would claim ticket number 0001; pre-create
    // a *directory* at that exact path so `createTicket`'s exclusive write fails for it alone
    // (EISDIR, not EEXIST, so it doesn't retry into a different number — it just fails).
    await mkdir(join(root, dir, "0001-some-raw-idea.md"), { recursive: true });
    const summary = await runImportBoard(root, dir, [draftItem, issueItem], true);
    const failed = summary.entries.find((e) => e.outcome === "failed");
    const imported = summary.entries.find((e) => e.outcome === "imported");
    expect(failed).toMatchObject({ importedFrom: importedFromOf(draftItem) });
    expect((failed as { reason: string }).reason.length).toBeGreaterThan(0);
    expect(imported).toMatchObject({ importedFrom: importedFromOf(issueItem) });
    const tickets = await listTickets(root, dir);
    expect(tickets).toHaveLength(1);
  });
});

test("readBoardItems: reads project items via gh, fetching issue title/body for issue-backed items, skipping non-ticket content", async () => {
  await stubGh(`
if [ "$1 $2 $3" = "project item-list 7" ]; then
  cat <<'JSON'
{"items":[
  {"id":"PVTI_1","status":"In Progress","priority":"High","content":{"type":"Issue","number":42,"repository":"acme/widgets"}},
  {"id":"PVTI_2","content":{"type":"DraftIssue","title":"Draft idea","body":"raw text"}},
  {"id":"PVTI_3","content":{"type":"PullRequest","number":9,"repository":"acme/widgets"}}
]}
JSON
  exit 0
fi
if [ "$1 $2" = "issue view" ]; then
  echo '{"number":42,"title":"Fix the thing","body":"the body"}'
  exit 0
fi
echo "unexpected args: $@" >&2
exit 1
`);
  const items = await readBoardItems("acme", 7);
  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({ kind: "issue", id: "PVTI_1", repo: "acme/widgets", number: 42, title: "Fix the thing", body: "the body", fields: { status: "In Progress", priority: "High" } });
  expect(items[1]).toMatchObject({ kind: "draft", id: "PVTI_2", title: "Draft idea", body: "raw text" });
});
