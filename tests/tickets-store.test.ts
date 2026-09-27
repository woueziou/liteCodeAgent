import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTicket, listTickets, listTicketsDetailed, nextNumber, writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const dirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-store-"));
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
    ...overrides,
  };
}

test("listTickets finds tickets nested under an epic directory", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-first.md"));

  const tickets = await listTickets(root, "docs/tickets");
  expect(tickets.map((t) => t.id)).toEqual(["0001-first"]);
  expect(tickets[0]!.path).toBe(join("docs/tickets", "epic-a", "0001-first.md"));
});

test("an empty epic directory contributes no entries and does not throw", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets/empty-epic"), { recursive: true });
  await writeTicket(root, fixture("docs/tickets/0001-flat.md"));

  const tickets = await listTickets(root, "docs/tickets");
  expect(tickets.map((t) => t.id)).toEqual(["0001-flat"]);
});

test("listTickets picks up a mix of flat and nested tickets in the same buffer", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-flat.md"));
  await writeTicket(root, fixture("docs/tickets/epic-a/0002-nested-a.md"));
  await writeTicket(root, fixture("docs/tickets/epic-b/0003-nested-b.md"));

  const tickets = await listTickets(root, "docs/tickets");
  expect(tickets.map((t) => t.id).sort()).toEqual(["0001-flat", "0002-nested-a", "0003-nested-b"]);
});

test("nextNumber accounts for tickets spread across multiple epics", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-flat.md"));
  await writeTicket(root, fixture("docs/tickets/epic-a/0003-nested-a.md"));
  await writeTicket(root, fixture("docs/tickets/epic-b/0002-nested-b.md"));

  const tickets = await listTickets(root, "docs/tickets");
  expect(nextNumber(tickets)).toBe(4);

  const created = await createTicket(root, "docs/tickets", { title: "Next one", label: "chore", body: "x" });
  expect(created.id.startsWith("0004-")).toBe(true);
});

test("dedup candidates (listTicketsDetailed) are collected across epics", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-first.md"));
  await writeTicket(root, fixture("docs/tickets/epic-b/0002-second.md"));

  const { tickets, errors } = await listTicketsDetailed(root, "docs/tickets");
  expect(errors).toEqual([]);
  expect(tickets.map((t) => t.id).sort()).toEqual(["0001-first", "0002-second"]);
});

test("README.md is excluded at the top level and inside an epic directory", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets/epic-a"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/README.md"), "# Tickets\n");
  await Bun.write(join(root, "docs/tickets/epic-a/README.md"), "# Epic A\n");
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-first.md"));

  const tickets = await listTickets(root, "docs/tickets");
  expect(tickets.map((t) => t.id)).toEqual(["0001-first"]);
});

test("a symlink resolving outside the project is rejected on every read, not only the first (see cc2af74)", async () => {
  const root = await tmpRoot();
  const outside = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await writeFile(join(outside, "secret.md"), "---\nschemaVersion: 2\nid: 0099-secret\ntitle: Secret\nlabel: chore\nstatus: backlog\npriority: medium\nsize: medium\nassignedAgent: human\n---\n\nBody.\n");
  await symlink(join(outside, "secret.md"), join(root, "docs/tickets/0099-escape.md"));

  for (let i = 0; i < 3; i++) {
    const { tickets, errors } = await listTicketsDetailed(root, "docs/tickets");
    expect(tickets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toContain("outside the project");
  }
});

test("a file gone by read time (ENOENT, e.g. a dangling symlink) is dropped silently", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  const ghostTarget = join(root, "docs/tickets/.ghost.md");
  await writeFile(ghostTarget, "---\nschemaVersion: 2\nid: 0098-ghost\ntitle: Ghost\nlabel: chore\nstatus: backlog\npriority: medium\nsize: medium\nassignedAgent: human\n---\n\nBody.\n");
  await symlink(ghostTarget, join(root, "docs/tickets/0098-ghost.md"));
  await rm(ghostTarget);

  const { tickets, errors } = await listTicketsDetailed(root, "docs/tickets");
  expect(tickets).toEqual([]);
  expect(errors).toEqual([]);
});
