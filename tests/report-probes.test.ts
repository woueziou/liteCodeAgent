import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realProbes } from "../src/report/probes.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function sh(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error(`failed: ${args.join(" ")}`);
}

async function commitAll(root: string, message: string): Promise<void> {
  await sh(root, "git", "add", ".");
  await sh(root, "git", "commit", "-q", "-m", message);
}

/** A repo on `main` with a feature branch that changes `src/a.ts`. */
async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-probes-"));
  dirs.push(root);
  await sh(root, "git", "init", "-q", "-b", "main");
  await sh(root, "git", "config", "user.email", "t@example.com");
  await sh(root, "git", "config", "user.name", "t");
  await sh(root, "git", "config", "core.hooksPath", "/dev/null");
  await Bun.write(join(root, "src/a.ts"), "a\n");
  await commitAll(root, "init");
  await sh(root, "git", "switch", "-q", "-c", "feat/x/issue-7");
  await Bun.write(join(root, "src/a.ts"), "b\n");
  await commitAll(root, "change");
  await sh(root, "git", "switch", "-q", "main");
  return root;
}

const ctx = (root: string) => ({ root, repo: "o/r", ticketsDir: "docs/tickets" });

function ticket(status: Ticket["status"]): Ticket {
  return {
    schemaVersion: 2,
    id: "0017-fix-something",
    title: "Fix something",
    label: "bug",
    status,
    priority: "high",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path: "docs/tickets/03-epic/0017-fix-something.md",
    body: "Body.\n",
  };
}

test("branchExists and branchFiles read the real repo", async () => {
  const root = await repo();
  const p = realProbes(ctx(root));
  expect(await p.branchExists("feat/x/issue-7")).toBe(true);
  expect(await p.branchExists("nope")).toBe(false);
  expect(await p.branchFiles("feat/x/issue-7")).toEqual(["src/a.ts"]);
});

test("branchFiles leaves out a parent PR branch's files on a follow-on branch", async () => {
  const root = await repo();
  await sh(root, "git", "switch", "-q", "-c", "feat/y/issue-8", "feat/x/issue-7");
  await Bun.write(join(root, "src/b.ts"), "b\n");
  await commitAll(root, "follow-on");
  await sh(root, "git", "switch", "-q", "main");
  expect(await realProbes(ctx(root)).branchFiles("feat/y/issue-8")).toEqual(["src/b.ts"]);
});

test("dirtyFiles lists modified and untracked paths, but not ticket files", async () => {
  const root = await repo();
  await Bun.write(join(root, "src/a.ts"), "leaked\n");
  await Bun.write(join(root, "new/dir/file.txt"), "x\n");
  await writeTicket(root, ticket("inProgress"));
  expect((await realProbes(ctx(root)).dirtyFiles()).sort()).toEqual(["new/dir/file.txt", "src/a.ts"]);
});

test("non-ASCII paths match between dirtyFiles and branchFiles", async () => {
  const root = await repo();
  await sh(root, "git", "switch", "-q", "feat/x/issue-7");
  await Bun.write(join(root, "docs/écart.md"), "a\n");
  await commitAll(root, "accent");
  await sh(root, "git", "switch", "-q", "main");
  await Bun.write(join(root, "docs/écart.md"), "leaked\n");
  const p = realProbes(ctx(root));
  expect(await p.dirtyFiles()).toEqual(["docs/écart.md"]);
  expect(await p.branchFiles("feat/x/issue-7")).toContain("docs/écart.md");
});

test("ticketStatuses finds a ticket by id, number, or #number", async () => {
  const root = await repo();
  await writeTicket(root, ticket("review"));
  const p = realProbes(ctx(root));
  expect(await p.ticketStatuses("0017-fix-something", undefined)).toEqual(["review"]);
  expect(await p.ticketStatuses("0017", undefined)).toEqual(["review"]);
  expect(await p.ticketStatuses("#0017", undefined)).toEqual(["review"]);
  expect(await p.ticketStatuses("17", undefined)).toEqual(["review"]);
  expect(await p.ticketStatuses("1", undefined)).toEqual([]);
  expect(await p.ticketStatuses("0018", undefined)).toEqual([]);
});

test("ticketStatuses also reads the branch's committed copy of the ticket", async () => {
  const root = await repo();
  await sh(root, "git", "switch", "-q", "feat/x/issue-7");
  await writeTicket(root, ticket("readyToMerge"));
  await commitAll(root, "move ticket");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("inProgress"));
  const statuses = await realProbes(ctx(root)).ticketStatuses("0017", "feat/x/issue-7");
  expect(statuses.sort()).toEqual(["inProgress", "readyToMerge"]);
});
