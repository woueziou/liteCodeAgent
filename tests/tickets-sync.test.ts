import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardData } from "../src/board/spec.ts";
import { applyTicketSync, planTicketSync } from "../src/tickets/sync.ts";
import { createTicket, listTickets } from "../src/tickets/store.ts";
import { commentBlock } from "../src/tickets/spec.ts";
import type { RemoteItem } from "../src/tickets/remote.ts";

const realBin = process.env.LITECODE_GH_BIN;

/**
 * Stands in for `gh`, and — unlike the rate-limit stub — records every invocation's
 * argv (one JSON line per call) to a log file so a test can assert on exactly which `gh`
 * subcommands ran, in order, without caring about stdout.
 */
async function stubGh(respond: string): Promise<{ bin: string; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  const log = join(dir, "calls.jsonl");
  await writeFile(log, "");
  const bin = join(dir, "gh");
  await writeFile(
    bin,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${respond}\n`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
  return { bin, log };
}

async function callsOf(log: string): Promise<string[]> {
  const content = await readFile(log, "utf8");
  return content.split("\n").filter(Boolean);
}

afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
  delete process.env.LITECODE_TICKET_SYNC_DELAY_MS;
});

function boardFixture(): BoardData {
  return {
    $generatedBy: "test",
    owner: "demo",
    number: 1,
    url: "https://github.com/orgs/demo/projects/1",
    projectId: "PVT_1",
    repo: "demo/demo",
    fields: {
      Status: { id: "FIELD_STATUS", kind: "single-select", options: { Backlog: "OPT_BACKLOG" } },
      Priority: { id: "FIELD_PRIORITY", kind: "single-select", options: { Low: "OPT_LOW", Medium: "OPT_MEDIUM", High: "OPT_HIGH" } },
      Size: { id: "FIELD_SIZE", kind: "single-select", options: { Trivial: "OPT_T", Small: "OPT_S", Medium: "OPT_M", Large: "OPT_L" } },
      "Assigned Agent": { id: "FIELD_AGENT", kind: "text" },
      "Due Date": { id: "FIELD_DUE", kind: "date" },
    },
    statusRoles: {
      backlog: { label: "Backlog", optionId: "OPT_BACKLOG" },
      planned: { label: "Planned", optionId: "OPT_PLANNED" },
      inProgress: { label: "In Progress", optionId: "OPT_IN_PROGRESS" },
      blocked: { label: "Blocked", optionId: "OPT_BLOCKED" },
      review: { label: "Review", optionId: "OPT_REVIEW" },
      readyToMerge: { label: "Ready to Merge", optionId: "OPT_RTM" },
      done: { label: "Done", optionId: "OPT_DONE" },
    },
  };
}

const SYNC_OPTS = { repo: "demo/demo", owner: "demo", number: 1, itemIdCache: ".claude/data/ids.json", delayMs: 0 };

test("a push past creation never sends a Status/Priority/Size item-edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  const ticket = await createTicket(root, dir, { title: "Already synced ticket", label: "feature", body: "Body." });
  await Bun.write(
    join(root, ticket.path),
    (await Bun.file(join(root, ticket.path)).text())
      .replace("issue: \n", "issue: 42\n")
      .replace("synced: false\n", "synced: true\n"),
  );
  const [reloaded] = await listTickets(root, dir);
  // Stage a comment so the ticket is dirty (pendingComments) without touching status/priority/size.
  await Bun.write(join(root, reloaded!.path), (await Bun.file(join(root, reloaded!.path)).text()).trimEnd() + `\n\n${commentBlock("hello")}`);
  const [dirty] = await listTickets(root, dir);
  expect(dirty!.pendingComments).toEqual(["hello"]);

  const { log } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2 $3" = "issue comment 42" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`);

  const board = boardFixture();
  const plan = planTicketSync([dirty!], board, new Map());
  expect(plan.actions).toHaveLength(1);
  expect(plan.actions[0]!.kind).toBe("update");

  const results = await applyTicketSync(root, plan, board, new Map(), SYNC_OPTS);

  const calls = await callsOf(log);
  expect(calls.some((c) => c.includes("item-edit"))).toBe(false);
  expect(calls.some((c) => c.startsWith("issue edit 42"))).toBe(true);
  expect(calls.some((c) => c.startsWith("issue comment 42"))).toBe(true);

  expect(results).toHaveLength(1);
  expect(results[0]!.outcome).toBe("synced");
  expect(results[0]!.detail).toContain("updated #42");
  expect(results[0]!.ticket.issue).toBe(42);
});

test("a failure right after `issue create` does not recreate the issue on re-run", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  await createTicket(root, dir, { title: "New ticket", label: "feature", body: "Body." });
  const board = boardFixture();

  // First attempt: issue create succeeds, then item-add explodes.
  const { log: log1 } = await stubGh(`
if [ "$1 $2" = "issue create" ]; then echo "https://github.com/demo/demo/issues/7"; exit 0; fi
if [ "$1 $2" = "project item-add" ]; then echo "boom" >&2; exit 1; fi
echo "unexpected gh call: $*" >&2; exit 1
`);

  const [ticket1] = await listTickets(root, dir);
  const plan1 = planTicketSync([ticket1!], board, new Map());
  expect(plan1.actions[0]!.kind).toBe("create");
  await expect(applyTicketSync(root, plan1, board, new Map(), SYNC_OPTS)).rejects.toThrow();

  const calls1 = await callsOf(log1);
  expect(calls1.filter((c) => c.startsWith("issue create")).length).toBe(1);

  const [afterFailure] = await listTickets(root, dir);
  expect(afterFailure!.issue).toBe(7);
  expect(afterFailure!.synced).toBe(false); // not marked synced: item-add/edits never ran

  // Second attempt: the file already carries issue #7, so the plan must be an update, not
  // a second create.
  const { log: log2 } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`);
  const plan2 = planTicketSync([afterFailure!], board, new Map());
  expect(plan2.actions).toHaveLength(1);
  expect(plan2.actions[0]!.kind).toBe("update");
  const results2 = await applyTicketSync(root, plan2, board, new Map(), SYNC_OPTS);
  expect(results2).toHaveLength(1);
  expect(results2[0]!.outcome).toBe("synced");
  expect(results2[0]!.detail).toContain("updated #7");

  const calls2 = await callsOf(log2);
  expect(calls2.some((c) => c.startsWith("issue create"))).toBe(false);
});

test("a partial comment batch failure only reposts the comments that never went out", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  const created = await createTicket(root, dir, { title: "Commented ticket", label: "feature", body: "Body." });
  await Bun.write(
    join(root, created.path),
    (await Bun.file(join(root, created.path)).text())
      .replace("issue: \n", "issue: 99\n")
      .replace("synced: false\n", "synced: true\n")
      .trimEnd() + `\n\n${commentBlock("first")}\n${commentBlock("second")}\n${commentBlock("third")}`,
  );
  const [ticket] = await listTickets(root, dir);
  expect(ticket!.pendingComments).toEqual(["first", "second", "third"]);

  const board = boardFixture();

  // Comment 1 and 2 succeed, comment 3 fails.
  const { log: log1 } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "issue comment" ]; then
  if [ "$4" = "third" ] || [[ "$*" == *"third"* ]]; then echo "boom" >&2; exit 1; fi
  exit 0
fi
echo "unexpected gh call: $*" >&2; exit 1
`);
  const plan1 = planTicketSync([ticket!], board, new Map());
  await expect(applyTicketSync(root, plan1, board, new Map(), SYNC_OPTS)).rejects.toThrow();

  const [afterFailure] = await listTickets(root, dir);
  expect(afterFailure!.pendingComments).toEqual(["third"]);

  // Re-run only reposts the one that never made it.
  const { log: log2 } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "issue comment" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`);
  const plan2 = planTicketSync([afterFailure!], board, new Map());
  await applyTicketSync(root, plan2, board, new Map(), SYNC_OPTS);

  const calls2 = await callsOf(log2);
  const comments = calls2.filter((c) => c.startsWith("issue comment"));
  expect(comments).toHaveLength(1);
  expect(comments[0]).toContain("third");

  const [finalTicket] = await listTickets(root, dir);
  expect(finalTicket!.pendingComments).toEqual([]);
  expect(finalTicket!.synced).toBe(true);
});

// ADR 0010: Status becomes push-on-update, sourced from a dirty local file, when it
// disagrees with what `remote` (this run's board fetch) just read for that issue.
// Priority/Size/Assigned Agent are untouched by any of this — see ADR 0001.

function remoteItem(issue: number, status: string): RemoteItem {
  return {
    itemId: `ITEM_${issue}`,
    issue,
    state: "OPEN",
    fields: new Map([["Status", status]]),
    title: null,
    body: null,
    labels: [],
  };
}

test("an update pushes a Status edit when the local file disagrees with the board", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  const created = await createTicket(root, dir, { title: "In-flight ticket", label: "feature", body: "Body." });
  await Bun.write(
    join(root, created.path),
    (await Bun.file(join(root, created.path)).text())
      .replace("issue: \n", "issue: 55\n")
      .replace("status: backlog\n", "status: inProgress\n")
      .replace("synced: false\n", "synced: true\n"),
  );
  const [reloaded] = await listTickets(root, dir);
  // Dirty the file the way `implementer` would: flip status, mark not-synced.
  await Bun.write(join(root, reloaded!.path), (await Bun.file(join(root, reloaded!.path)).text()).replace("synced: true\n", "synced: false\n"));
  const [dirty] = await listTickets(root, dir);
  expect(dirty!.status).toBe("inProgress");

  const board = boardFixture();
  const remote = new Map([[55, remoteItem(55, "Planned")]]);

  const plan = planTicketSync([dirty!], board, remote);
  expect(plan.actions).toHaveLength(1);
  const action = plan.actions[0]!;
  expect(action.kind).toBe("update");
  expect(action.kind === "update" ? action.edits : []).toEqual([
    { field: "Status", fieldId: "FIELD_STATUS", from: "Planned", to: "In Progress", optionId: "OPT_IN_PROGRESS" },
  ]);

  const { log } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "project item-edit" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`);
  const results = await applyTicketSync(root, plan, board, remote, SYNC_OPTS);

  const calls = await callsOf(log);
  expect(calls.some((c) => c.includes("item-edit") && c.includes("ITEM_55") && c.includes("OPT_IN_PROGRESS"))).toBe(true);
  expect(results[0]!.outcome).toBe("synced");
});

test("an update sends no Status edit when the local file already agrees with the board", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  const created = await createTicket(root, dir, { title: "Already-in-sync ticket", label: "feature", body: "Body." });
  await Bun.write(
    join(root, created.path),
    (await Bun.file(join(root, created.path)).text())
      .replace("issue: \n", "issue: 56\n")
      .trimEnd() + `\n\n${commentBlock("hi")}`,
  );
  const [dirty] = await listTickets(root, dir);
  expect(dirty!.status).toBe("backlog");

  const board = boardFixture();
  const remote = new Map([[56, remoteItem(56, "Backlog")]]);
  const plan = planTicketSync([dirty!], board, remote);
  const action = plan.actions[0]!;
  expect(action.kind === "update" ? action.edits : ["not-empty"]).toEqual([]);

  const { log } = await stubGh(`
if [ "$1 $2" = "issue edit" ]; then exit 0; fi
if [ "$1 $2" = "issue comment" ]; then exit 0; fi
echo "unexpected gh call: $*" >&2; exit 1
`);
  await applyTicketSync(root, plan, board, remote, SYNC_OPTS);
  const calls = await callsOf(log);
  expect(calls.some((c) => c.includes("item-edit"))).toBe(false);
});

test("an update sends no Status edit when remote has no entry for the issue yet", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-tickets-"));
  const dir = "docs/tickets";
  const created = await createTicket(root, dir, { title: "Unknown-to-remote ticket", label: "feature", body: "Body." });
  await Bun.write(
    join(root, created.path),
    (await Bun.file(join(root, created.path)).text())
      .replace("issue: \n", "issue: 57\n")
      .replace("status: backlog\n", "status: inProgress\n")
      .replace("synced: false\n", "synced: true\n")
      .trimEnd() + `\n\n${commentBlock("hi")}`,
  );
  const [dirty] = await listTickets(root, dir);

  const board = boardFixture();
  const plan = planTicketSync([dirty!], board, new Map());
  const action = plan.actions[0]!;
  expect(action.kind === "update" ? action.edits : ["not-empty"]).toEqual([]);
});
