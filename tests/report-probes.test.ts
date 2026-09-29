import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { realProbes, realResumeProbes } from "../src/report/probes.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const dirs: string[] = [];
const realGhBin = process.env.LITECODE_GH_BIN;

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
  if (realGhBin) process.env.LITECODE_GH_BIN = realGhBin;
  else delete process.env.LITECODE_GH_BIN;
});

/** Stands in for the `gh` binary, same technique as `tests/gh-rate-limit.test.ts`. */
async function stubGh(script: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-stub-"));
  dirs.push(dir);
  const bin = join(dir, "gh");
  await writeFile(bin, `#!/usr/bin/env bash\n${script}\n`);
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;
}

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
  // Scratch commits must not depend on the developer's global signing setup (an SSH or GPG
  // signer that prompts, or is locked, fails every commit here).
  await sh(root, "git", "config", "commit.gpgsign", "false");
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
    extraFrontmatter: {},
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
  expect(await p.ticketStatus("0017-fix-something")).toBe("review");
  expect(await p.ticketStatus("0017")).toBe("review");
  expect(await p.ticketStatus("#0017")).toBe("review");
  expect(await p.ticketStatus("17")).toBe("review");
  expect(await p.ticketStatus("1")).toBeUndefined();
  expect(await p.ticketStatus("0018")).toBeUndefined();
});

test("worktreeExists resolves a relative worktree path against the primary checkout, not the cwd it's called from", async () => {
  const root = await repo();
  const worktreesDir = join(root, "..", "worktrees-" + root.split("/").pop());
  dirs.push(worktreesDir);
  await sh(root, "git", "worktree", "add", "-q", join(worktreesDir, "0049"), "feat/x/issue-7");

  // `resume` launched from inside the linked worktree, not the primary checkout — the
  // journal's `worktree:` path is relative to the primary checkout regardless (ticket 0049).
  const fromInsideTheWorktree = realResumeProbes({ root: join(worktreesDir, "0049"), repo: "o/r", ticketsDir: "docs/tickets" });
  const relativePath = relative(root, join(worktreesDir, "0049"));
  expect(await fromInsideTheWorktree.worktreeExists(relativePath)).toBe(true);
  expect(await fromInsideTheWorktree.worktreeExists("../does-not-exist/0049")).toBe(false);
});

test("prChecks reports fail, pending (exit 8 with JSON still on stdout), pass, none and unknown", async () => {
  const root = await repo();
  const p = realProbes(ctx(root));

  await stubGh(`echo '[{"bucket":"pass"},{"bucket":"fail"}]'; exit 0`);
  expect(await p.prChecks("7")).toEqual({ kind: "fail" });

  await stubGh(`echo '[{"bucket":"pass"},{"bucket":"pending"}]'; exit 8`);
  expect(await p.prChecks("7")).toEqual({ kind: "pending" });

  await stubGh(`echo '[{"bucket":"pass"},{"bucket":"skipping"}]'; exit 0`);
  expect(await p.prChecks("7")).toEqual({ kind: "pass" });

  await stubGh(`echo 'no checks reported on the '"'"'main'"'"' branch' >&2; exit 1`);
  expect(await p.prChecks("7")).toEqual({ kind: "none" });

  await stubGh(`echo 'gh: some other failure' >&2; exit 1`);
  expect(await p.prChecks("7")).toEqual({ kind: "unknown", reason: "gh: some other failure" });
});

test("prChecks reports unknown, not an uncaught throw, when the gh binary itself doesn't exist", async () => {
  const root = await repo();
  process.env.LITECODE_GH_BIN = "/does/not/exist/gh";
  const result = await realProbes(ctx(root)).prChecks("7");
  expect(result.kind).toBe("unknown");
});

test("forcePushed reports yes with a count, no, and unknown on a gh failure", async () => {
  const root = await repo();
  const p = realProbes(ctx(root));

  await stubGh(`
    case "$*" in
      "pr view 7 --json number,headRepository,headRepositoryOwner --repo o/r")
        echo '{"number":7,"headRepository":{"name":"r"},"headRepositoryOwner":{"login":"o"}}';;
      "api repos/o/r/issues/7/events --paginate --jq .[].event")
        printf 'commented\\nhead_ref_force_pushed\\nclosed\\nhead_ref_force_pushed\\n';;
      *) exit 1;;
    esac
  `);
  expect(await p.forcePushed("7")).toEqual({ kind: "yes", count: 2 });

  await stubGh(`
    case "$*" in
      "pr view 7 --json number,headRepository,headRepositoryOwner --repo o/r")
        echo '{"number":7,"headRepository":{"name":"r"},"headRepositoryOwner":{"login":"o"}}';;
      "api repos/o/r/issues/7/events --paginate --jq .[].event")
        printf 'commented\\nclosed\\n';;
      *) exit 1;;
    esac
  `);
  expect(await p.forcePushed("7")).toEqual({ kind: "no" });

  await stubGh(`echo 'gh: pull request not found' >&2; exit 1`);
  const unknown = await p.forcePushed("7");
  expect(unknown.kind).toBe("unknown");
});

test("ticketStatus reads only the primary checkout, never a stale copy committed on a branch", async () => {
  const root = await repo();
  await sh(root, "git", "switch", "-q", "feat/x/issue-7");
  await writeTicket(root, ticket("planned"));
  await commitAll(root, "stale ticket copy on the branch");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("inProgress"));
  expect(await realProbes(ctx(root)).ticketStatus("0017")).toBe("inProgress");
});
