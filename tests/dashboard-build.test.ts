import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDashboard, epicOf } from "../src/dashboard/build.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const dirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-dashboard-build-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function fixture(path: string, overrides: Partial<Ticket> = {}): Ticket {
  const id = path.split("/").pop()!.replace(/\.md$/, "");
  return {
    schemaVersion: 1,
    id,
    title: `Ticket ${id}`,
    label: "chore",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    issue: undefined,
    synced: false,
    syncedAt: undefined,
    path,
    body: "Body.\n",
    pendingComments: [],
    ...overrides,
  };
}

test("buildDashboard on an empty buffer returns zeroed counts, no throw", async () => {
  const root = await tmpRoot();
  const data = await buildDashboard(root, "docs/tickets");

  expect(data.total).toBe(0);
  expect(data.tickets).toEqual([]);
  expect(data.blockedTickets).toEqual([]);
  expect(data.epics).toEqual([]);
  expect(data.byStatus.every((s) => s.count === 0)).toBe(true);
});

test("aggregates counts by status/priority/size/label across epics", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-one.md", { status: "blocked", priority: "high", size: "small", label: "bug" }));
  await writeTicket(root, fixture("docs/tickets/epic-a/0002-two.md", { status: "done", priority: "low", size: "large", label: "feature" }));
  await writeTicket(root, fixture("docs/tickets/epic-b/0003-three.md", { status: "readyToMerge", priority: "medium", size: "medium", label: "feature" }));
  await writeTicket(root, fixture("docs/tickets/0004-flat.md", { status: "planned" }));

  const data = await buildDashboard(root, "docs/tickets");

  expect(data.total).toBe(4);
  expect(data.byStatus.find((s) => s.role === "blocked")?.count).toBe(1);
  expect(data.byStatus.find((s) => s.role === "readyToMerge")?.count).toBe(1);
  expect(data.byStatus.find((s) => s.role === "done")?.count).toBe(1);
  expect(data.byPriority.find((p) => p.priority === "high")?.count).toBe(1);
  expect(data.bySize.find((s) => s.size === "large")?.count).toBe(1);
  expect(data.byLabel.find((l) => l.label === "feature")?.count).toBe(2);

  const epicA = data.epics.find((e) => e.epic === "epic-a")!;
  expect(epicA.total).toBe(2);
  expect(epicA.blocked).toBe(1);
  const epicB = data.epics.find((e) => e.epic === "epic-b")!;
  expect(epicB.total).toBe(1);
  const flat = data.epics.find((e) => e.epic === "(sans epic)")!;
  expect(flat.total).toBe(1);

  expect(data.blockedTickets.map((t) => t.id)).toEqual(["0001-one"]);
});

test("readyToMerge is tracked distinctly from done", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-a.md", { status: "readyToMerge" }));

  const data = await buildDashboard(root, "docs/tickets");
  expect(data.byStatus.find((s) => s.role === "readyToMerge")?.count).toBe(1);
  expect(data.byStatus.find((s) => s.role === "done")?.count).toBe(0);
});

test("epicOf groups a flat ticket under '(sans epic)' and a nested one by its directory", () => {
  const flat = fixture("docs/tickets/0001-flat.md");
  const nested = fixture("docs/tickets/local-first-tickets/0028-x.md");

  expect(epicOf(flat, "docs/tickets")).toBe("(sans epic)");
  expect(epicOf(nested, "docs/tickets")).toBe("local-first-tickets");
});

test("a malformed ticket file is surfaced as a loadError, not a thrown exception", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-good.md"));
  await Bun.write(join(root, "docs/tickets/0002-bad.md"), "not a valid ticket file\n");

  const data = await buildDashboard(root, "docs/tickets");
  expect(data.total).toBe(1);
  expect(data.loadErrors.length).toBe(1);
  expect(data.loadErrors[0]!.path).toContain("0002-bad.md");
});
