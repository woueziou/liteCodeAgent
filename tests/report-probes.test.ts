import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realProbes } from "../src/report/probes.ts";
import { writeTicket } from "../src/tickets/store.ts";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function sh(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error(`failed: ${args.join(" ")}`);
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
  await sh(root, "git", "add", ".");
  await sh(root, "git", "commit", "-q", "-m", "init");
  await sh(root, "git", "switch", "-q", "-c", "feat/x/issue-7");
  await Bun.write(join(root, "src/a.ts"), "b\n");
  await sh(root, "git", "commit", "-q", "-am", "change");
  await sh(root, "git", "switch", "-q", "main");
  return root;
}

const ctx = (root: string) => ({ root, repo: "o/r", defaultBranch: "main", ticketsDir: "docs/tickets" });

test("branchExists and branchFiles read the real repo", async () => {
  const root = await repo();
  const p = realProbes(ctx(root));
  expect(await p.branchExists("feat/x/issue-7")).toBe(true);
  expect(await p.branchExists("nope")).toBe(false);
  expect(await p.branchFiles("feat/x/issue-7")).toEqual(["src/a.ts"]);
});

test("dirtyFiles lists modified and untracked paths in the primary checkout", async () => {
  const root = await repo();
  await Bun.write(join(root, "src/a.ts"), "leaked\n");
  await Bun.write(join(root, "new.txt"), "x\n");
  expect((await realProbes(ctx(root)).dirtyFiles()).sort()).toEqual(["new.txt", "src/a.ts"]);
});

test("ticketStatus finds a ticket by #issue or by local id", async () => {
  const root = await repo();
  await writeTicket(root, {
    schemaVersion: 1,
    id: "0017-fix-something",
    title: "Fix something",
    label: "bug",
    status: "review",
    priority: "high",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    issue: 45,
    synced: true,
    syncedAt: undefined,
    path: "docs/tickets/03-epic/0017-fix-something.md",
    body: "Body.\n",
    pendingComments: [],
  });
  const p = realProbes(ctx(root));
  expect(await p.ticketStatus("#45")).toBe("review");
  expect(await p.ticketStatus("0017")).toBe("review");
  expect(await p.ticketStatus("#46")).toBeUndefined();
});
