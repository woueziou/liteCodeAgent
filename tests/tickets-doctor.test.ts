import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctor } from "../src/tickets/doctor.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const dirs: string[] = [];

async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-doctor-"));
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

test("a clean flat ticket buffer reports no findings", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-first.md"));

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toEqual([]);
});

test("a clean epic-nested ticket buffer reports no findings", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-first.md"));

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toEqual([]);
});

test("an empty tickets directory reports no findings", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toEqual([]);
});

test("a missing opening delimiter is reported, naming the file", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/0001-broken.md"), "schemaVersion: 1\nid: 0001-broken\n---\n\nBody.\n");

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("error");
  expect(findings[0]!.message).toContain("0001-broken.md");
  expect(findings[0]!.message).toContain("missing frontmatter");
});

test("an unterminated frontmatter block is reported", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/0001-unterminated.md"), "---\nschemaVersion: 1\nid: 0001-unterminated\n\nBody.\n");

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message).toContain("unterminated frontmatter");
});

test("frontmatter that fails TicketSchema is reported with the offending field", async () => {
  const root = await tmpRoot();
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await Bun.write(
    join(root, "docs/tickets/0001-bad-label.md"),
    "---\nschemaVersion: 1\nid: 0001-bad-label\ntitle: Bad\nlabel: not-a-real-label\n---\n\nBody.\n",
  );

  const findings = await doctor(root, "docs/tickets");
  expect(findings.some((f) => f.severity === "error" && f.message.includes("label"))).toBe(true);
});

test("a ticket file whose name doesn't match its own id is flagged", async () => {
  const root = await tmpRoot();
  const ticket = fixture("docs/tickets/0001-first.md");
  await writeTicket(root, { ...ticket, path: "docs/tickets/0002-mismatched-name.md" });

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message).toContain("doesn't match its own id");
});

test("a ticket nested two directories deep is flagged", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/sub/0001-too-deep.md"));

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message).toContain("nested more than one directory");
});

test("duplicate ticket numbers across epics are flagged, naming both files", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/epic-a/0001-first.md"));
  await writeTicket(root, fixture("docs/tickets/epic-b/0001-second.md"));

  const findings = await doctor(root, "docs/tickets");
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("error");
  expect(findings[0]!.message).toContain("duplicate ticket number '0001'");
  expect(findings[0]!.message).toContain("epic-a/0001-first.md");
  expect(findings[0]!.message).toContain("epic-b/0001-second.md");
});

test("a malformed file does not stop duplicate-number or placement checks on the rest", async () => {
  const root = await tmpRoot();
  await writeTicket(root, fixture("docs/tickets/0001-first.md"));
  await writeTicket(root, fixture("docs/tickets/0001-first.md", { path: "docs/tickets/0002-second.md" }));
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/0003-broken.md"), "no frontmatter at all\n");

  const findings = await doctor(root, "docs/tickets");
  const messages = findings.map((f) => f.message);
  expect(messages.some((m) => m.includes("0003-broken.md") && m.includes("missing frontmatter"))).toBe(true);
  expect(messages.some((m) => m.includes("doesn't match its own id"))).toBe(true);
  expect(messages.some((m) => m.includes("duplicate ticket number '0001'"))).toBe(true);
});
