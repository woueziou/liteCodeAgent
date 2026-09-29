import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { realProbes, realResumeProbes } from "../src/report/probes.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

// Every prChecks case spawns a bash stub (several times when polling): slow on a loaded machine.
setDefaultTimeout(30_000);

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

test("dirtyFiles ignores agents' isolated worktrees under .claude/worktrees/", async () => {
  const root = await repo();
  await Bun.write(join(root, ".claude/worktrees/agent-abc/src/a.ts"), "x\n");
  await Bun.write(join(root, "src/a.ts"), "leaked\n");
  expect(await realProbes(ctx(root)).dirtyFiles()).toEqual(["src/a.ts"]);
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

const T = (bucket: string, name = "test") => `{"name":"${name}","bucket":"${bucket}"}`;
const fast = { noChecksWait: { retries: 2, intervalMs: 5 } };

/** A counter file the stub appends to, so a test can see how many times gh was called. */
async function counterFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-gh-count-"));
  dirs.push(dir);
  const file = join(dir, "calls");
  await writeFile(file, "");
  return file;
}
const callCount = async (file: string) => (await Bun.file(file).text()).split("\n").filter(Boolean).length;

test("prChecks reports fail, pending (exit 8 with JSON still on stdout), pass, none and unknown", async () => {
  const root = await repo();
  const p = realProbes({ ...ctx(root), ...fast });

  // gh exits 1 for a failing check but still prints the JSON on stdout.
  await stubGh(`echo '[${T("pass")},${T("fail", "lint")}]'; exit 1`);
  expect(await p.prChecks("7")).toEqual({ kind: "fail" });

  await stubGh(`echo '[${T("pass")},${T("pending", "lint")}]'; exit 8`);
  expect(await p.prChecks("7")).toEqual({ kind: "pending" });

  await stubGh(`echo '[${T("pass")},${T("skipping", "lint")}]'; exit 0`);
  expect(await p.prChecks("7")).toEqual({ kind: "pass" });

  await stubGh(`echo 'no checks reported on the '"'"'main'"'"' branch' >&2; exit 1`);
  expect(await p.prChecks("7")).toEqual({ kind: "none" });

  await stubGh(`echo 'gh: some other failure' >&2; exit 1`);
  const r = await p.prChecks("7");
  expect(r.kind).toBe("unknown");
  expect(JSON.stringify(r)).toContain("gh: some other failure");
});

test("prChecks: an unrelated gh error printed next to an empty array is unknown, not none", async () => {
  const root = await repo();
  await stubGh(`echo '[]'; echo 'HTTP 502' >&2; exit 1`);
  expect((await realProbes({ ...ctx(root), ...fast }).prChecks("7")).kind).toBe("unknown");
});

test("prChecks asks gh for the check names, not just the buckets", async () => {
  const root = await repo();
  await stubGh(`case "$*" in *"--json name,bucket"*) echo '[${T("pass")}]';; *) echo 'bad args' >&2; exit 1;; esac`);
  expect(await realProbes({ ...ctx(root), ...fast }).prChecks("7")).toEqual({ kind: "pass" });
});

test("prChecks never reports pass when only non-test checks ran (stacked PR, ticket 0059)", async () => {
  const root = await repo();
  await stubGh(`echo '[${T("pass", "GitGuardian Security Checks")}]'; exit 0`);
  const r = await realProbes({ ...ctx(root), ...fast }).prChecks("7");
  expect(r.kind).toBe("no-test-check");
  expect(JSON.stringify(r)).toContain("GitGuardian Security Checks");
});

test("prChecks treats a skipped test check as not having run", async () => {
  const root = await repo();
  await stubGh(`echo '[${T("skipping")}]'; exit 0`);
  expect((await realProbes({ ...ctx(root), ...fast }).prChecks("7")).kind).toBe("no-test-check");
});

test("prChecks: a failing non-test check still wins over a missing test check", async () => {
  const root = await repo();
  await stubGh(`echo '[${T("fail", "lint")}]'; exit 1`);
  expect(await realProbes({ ...ctx(root), ...fast }).prChecks("7")).toEqual({ kind: "fail" });
});

test("prChecks expected test check names are configurable, matched case-insensitively", async () => {
  const root = await repo();
  await stubGh(`echo '[${T("pass", "Build-And-Test")}]'; exit 0`);
  expect((await realProbes({ ...ctx(root), ...fast }).prChecks("7")).kind).toBe("no-test-check");
  expect(await realProbes({ ...ctx(root), ...fast, testChecks: ["build-and-test"] }).prChecks("7")).toEqual({ kind: "pass" });
  // Every configured name must have run.
  expect((await realProbes({ ...ctx(root), ...fast, testChecks: ["build-and-test", "e2e"] }).prChecks("7")).kind).toBe(
    "no-test-check",
  );
  // An empty list turns the requirement off.
  await stubGh(`echo '[${T("pass", "anything")}]'; exit 0`);
  expect(await realProbes({ ...ctx(root), ...fast, testChecks: [] }).prChecks("7")).toEqual({ kind: "pass" });
});

test("prChecks waits a bounded time for checks not yet registered right after a push", async () => {
  const root = await repo();
  const counter = await counterFile();
  await stubGh(`
    echo x >> ${counter}
    if [ "$(wc -l < ${counter})" -lt 3 ]; then echo 'no checks reported on the branch' >&2; exit 1; fi
    echo '[${T("pass")}]'
  `);
  expect(await realProbes({ ...ctx(root), noChecksWait: { retries: 50, intervalMs: 5 } }).prChecks("7")).toEqual({ kind: "pass" });

  // Never registers: gives up with none after the bound, having polled more than once.
  const never = await counterFile();
  await stubGh(`echo x >> ${never}; echo 'no checks reported on the branch' >&2; exit 1`);
  expect(await realProbes({ ...ctx(root), ...fast }).prChecks("7")).toEqual({ kind: "none" });
  expect(await callCount(never)).toBeGreaterThan(1);
});

test("prChecks waits for the test check to register when only other checks have", async () => {
  const root = await repo();
  const counter = await counterFile();
  await stubGh(`
    echo x >> ${counter}
    if [ "$(wc -l < ${counter})" -lt 2 ]; then echo '[${T("pass", "GitGuardian")}]'; exit 0; fi
    echo '[${T("pass", "GitGuardian")},${T("pass")}]'
  `);
  expect(await realProbes({ ...ctx(root), noChecksWait: { retries: 50, intervalMs: 5 } }).prChecks("7")).toEqual({ kind: "pass" });
});

test("prChecks goes through the shared gh() rate-limit handling", async () => {
  const root = await repo();
  const counter = await counterFile();
  process.env.LITECODE_GH_BACKOFF_MS = "1";
  try {
    await stubGh(`
      if [ "$1" = "api" ]; then echo '{"resources":{"graphql":{"remaining":4000,"reset":1}}}'; exit 0; fi
      echo x >> ${counter}
      if [ "$(wc -l < ${counter})" -lt 2 ]; then echo 'API rate limit exceeded (secondary rate limit)' >&2; exit 1; fi
      echo '[${T("pass")}]'
    `);
    expect(await realProbes({ ...ctx(root), ...fast }).prChecks("7")).toEqual({ kind: "pass" });

    // A drained hourly quota is unknown, with the reason, not an endless retry.
    await stubGh(`
      if [ "$1" = "api" ]; then echo '{"resources":{"graphql":{"remaining":0,"reset":4102444800}}}'; exit 0; fi
      echo 'API rate limit exceeded' >&2; exit 1
    `);
    const r = await realProbes({ ...ctx(root), ...fast }).prChecks("7");
    expect(r.kind).toBe("unknown");
    expect(JSON.stringify(r)).toContain("quota");
  } finally {
    delete process.env.LITECODE_GH_BACKOFF_MS;
  }
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
      "pr view 7 --json number,url --repo o/r")
        echo '{"number":7,"url":"https://github.com/o/r/pull/7"}';;
      "api repos/o/r/issues/7/events --paginate --jq .[].event")
        printf 'commented\\nhead_ref_force_pushed\\nclosed\\nhead_ref_force_pushed\\n';;
      *) exit 1;;
    esac
  `);
  expect(await p.forcePushed("7")).toEqual({ kind: "yes", count: 2 });

  await stubGh(`
    case "$*" in
      "pr view 7 --json number,url --repo o/r")
        echo '{"number":7,"url":"https://github.com/o/r/pull/7"}';;
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

test("forcePushed queries the base repo from the PR url, keeps the gh stderr as the reason", async () => {
  const root = await repo();
  const p = realProbes(ctx(root));
  await stubGh(`
    case "$*" in
      "pr view https://github.com/base/repo/pull/9 --json number,url")
        echo '{"number":9,"url":"https://github.com/base/repo/pull/9"}';;
      "api repos/base/repo/issues/9/events --paginate --jq .[].event")
        printf 'head_ref_force_pushed\\n';;
      *) exit 1;;
    esac
  `);
  expect(await p.forcePushed("https://github.com/base/repo/pull/9")).toEqual({ kind: "yes", count: 1 });

  await stubGh(`echo 'no pull requests found' >&2; exit 1`);
  const r = await p.forcePushed("7");
  expect(r.kind === "unknown" && r.reason).toContain("no pull requests found");
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
