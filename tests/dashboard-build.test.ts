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
    schemaVersion: 2,
    id,
    title: `Ticket ${id}`,
    label: "chore",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path,
    body: "Body.\n",
    extraFrontmatter: {},
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

test("buildDashboard also loads ADRs from docs/decisions under the same root", async () => {
  const root = await tmpRoot();
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(
    join(root, "docs/decisions/0017-example.md"),
    '---\ngenerated_by: implementer\ntask: "0032"\n---\n\n# 0017. Example\n\nStatus: proposed\nDate: 2026-09-27\n\nBody.\n',
  );
  await writeFile(join(root, "docs/decisions/0018-broken.md"), "no heading\n");

  const data = await buildDashboard(root, "docs/tickets");
  expect(data.adrs.map((a) => a.id)).toEqual(["0017"]);
  expect(data.adrLoadErrors.length).toBe(1);
});

test("buildDashboard surfaces ADR drafts pending approval (ticket 0047), and drops them once committed", async () => {
  const root = await tmpRoot();
  const draftBody = `
## ADR à valider : 0019

Draft awaiting approval.

# 0019. Pending decision

\`\`\`resume-manifest
worktree: ../worktrees/0047
branch: feat/x/0047
commit: none
adr_path: docs/decisions/0019-pending.md
board_status: In Progress
checks_passed: not yet run
adr_posted: true
\`\`\`
`;
  await writeTicket(root, fixture("docs/tickets/0047-x.md", { status: "inProgress", body: draftBody }));

  const pending = await buildDashboard(root, "docs/tickets");
  expect(pending.pendingAdrs).toHaveLength(1);
  expect(pending.pendingAdrs[0]).toMatchObject({ ticketId: "0047-x", adrPath: "docs/decisions/0019-pending.md", adrNumber: "0019" });

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await writeFile(join(root, "docs/decisions/0019-pending.md"), "# 0019. Pending decision\n\nStatus: accepted\n");

  const committed = await buildDashboard(root, "docs/tickets");
  expect(committed.pendingAdrs).toEqual([]);
});
