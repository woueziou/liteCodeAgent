import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardData } from "../src/board/spec.ts";
import { planTicketHydration, applyTicketHydration } from "../src/tickets/sync.ts";
import { listTickets } from "../src/tickets/store.ts";
import type { RemoteItem } from "../src/tickets/remote.ts";
import type { Ticket } from "../src/tickets/spec.ts";

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

function remoteItem(overrides: Partial<RemoteItem> & { issue: number }): RemoteItem {
  return {
    itemId: `ITEM_${overrides.issue}`,
    state: "OPEN",
    fields: new Map(),
    title: `Issue ${overrides.issue}`,
    body: "Some body.",
    labels: ["feature"],
    ...overrides,
  };
}

test("hydrates a local file for a board item that has none yet", () => {
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([
    [
      18,
      remoteItem({
        issue: 18,
        title: "Some issue filed directly on GitHub",
        fields: new Map([
          ["Status", "Planned"],
          ["Priority", "High"],
          ["Size", "Small"],
        ]),
      }),
    ],
  ]);

  const plan = planTicketHydration([], board, remote, "docs/tickets");

  expect(plan.skipped).toEqual([]);
  expect(plan.toCreate).toHaveLength(1);
  const [ticket] = plan.toCreate;
  expect(ticket!.issue).toBe(18);
  expect(ticket!.status).toBe("planned");
  expect(ticket!.priority).toBe("high");
  expect(ticket!.size).toBe("small");
  expect(ticket!.synced).toBe(true);
  expect(ticket!.title).toBe("Some issue filed directly on GitHub");
});

test("skips a board item whose Status is NULL, and logs why", () => {
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([[16, remoteItem({ issue: 16, fields: new Map() })]]);

  const plan = planTicketHydration([], board, remote, "docs/tickets");

  expect(plan.toCreate).toEqual([]);
  expect(plan.skipped).toEqual([{ issue: 16, reason: "no Status set on the board item — nothing to rank it by" }]);
});

test("does not re-hydrate a board item that already has a local file", () => {
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([[42, remoteItem({ issue: 42, fields: new Map([["Status", "Backlog"]]) })]]);
  const existing: Ticket[] = [
    {
      schemaVersion: 1,
      id: "0001-existing",
      title: "Existing",
      label: "feature",
      status: "backlog",
      priority: "medium",
      size: "medium",
      assignedAgent: "human",
      dueDate: undefined,
      issue: 42,
      synced: true,
      syncedAt: "2026-01-01T00:00:00.000Z",
      path: "docs/tickets/0001-existing.md",
      body: "Body.\n",
      pendingComments: [],
    },
  ];

  const plan = planTicketHydration(existing, board, remote, "docs/tickets");

  expect(plan.toCreate).toEqual([]);
  expect(plan.skipped).toEqual([]);
});

test("skips a closed issue as not pipeline-relevant", () => {
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([[19, remoteItem({ issue: 19, state: "CLOSED", fields: new Map([["Status", "Done"]]) })]]);

  const plan = planTicketHydration([], board, remote, "docs/tickets");

  expect(plan.toCreate).toEqual([]);
  expect(plan.skipped).toEqual([{ issue: 19, reason: "issue is closed, not pipeline-relevant" }]);
});

test("assigns distinct ids when hydrating more than one board item in a batch", () => {
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([
    [20, remoteItem({ issue: 20, title: "First", fields: new Map([["Status", "Backlog"]]) })],
    [21, remoteItem({ issue: 21, title: "Second", fields: new Map([["Status", "Backlog"]]) })],
  ]);

  const plan = planTicketHydration([], board, remote, "docs/tickets");

  expect(plan.toCreate).toHaveLength(2);
  const ids = plan.toCreate.map((t) => t.id);
  expect(new Set(ids).size).toBe(2);
});

test("applyTicketHydration writes every hydrated ticket to disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-hydrate-"));
  const board = boardFixture();
  const remote = new Map<number, RemoteItem>([[30, remoteItem({ issue: 30, title: "Hydrate me", fields: new Map([["Status", "Backlog"]]) })]]);
  const plan = planTicketHydration([], board, remote, "docs/tickets");

  await applyTicketHydration(root, plan.toCreate);

  const onDisk = await listTickets(root, "docs/tickets");
  expect(onDisk).toHaveLength(1);
  expect(onDisk[0]!.issue).toBe(30);
  expect(onDisk[0]!.synced).toBe(true);
});
