import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema, type Config } from "../src/config.ts";
import { doctor } from "../src/doctor.ts";
import { writeTicket } from "../src/tickets/store.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const PACKS = join(import.meta.dir, "..", "packs");

// A minimal config that satisfies `core`'s own required config paths, so `buildPlan`'s
// pre-install validation (unrelated to drift) never fires — only the `web` example config
// would otherwise trip it here, which is `checkInstallDrift`'s failure mode, not this
// module's, and would drown every other test's findings under it.
const BASE_CONFIG = {
  packs: ["core"],
  project: {
    name: "doctor-fixture",
    repo: "o/r",
    checkCommand: "true",
    worktreeRoot: "../worktrees",
    tickets: { enabled: true, dir: "docs/tickets" },
    angles: [{ name: "default", covers: "everything", triggeredBy: "any change", skills: [], always: true }],
  },
};

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

async function tmpRepo(): Promise<string> {
  // Nested one level so `root/../worktrees` resolves under a directory unique to this test,
  // not the shared system tmpdir (parallel tests would otherwise collide on it).
  const base = await mkdtemp(join(tmpdir(), "litecode-doctor-"));
  dirs.push(base);
  const root = join(base, "repo");
  await mkdir(root, { recursive: true });
  await sh(root, "git", "init", "-q", "-b", "main");
  await sh(root, "git", "config", "user.email", "t@example.com");
  await sh(root, "git", "config", "user.name", "t");
  await sh(root, "git", "config", "core.hooksPath", "/dev/null");
  await sh(root, "git", "config", "commit.gpgsign", "false");
  await Bun.write(join(root, "README.md"), "x\n");
  await commitAll(root, "init");
  return root;
}

async function exampleConfig(overrides: Partial<Config["project"]> = {}): Promise<Config> {
  const config = ConfigSchema.parse(structuredClone(BASE_CONFIG));
  Object.assign(config.project, overrides);
  return config;
}

function ticket(id: string, status: Ticket["status"]): Ticket {
  return {
    schemaVersion: 2,
    id,
    title: `Ticket ${id}`,
    label: "chore",
    status,
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path: `docs/tickets/${id}.md`,
    body: "Body.\n## Critères d'acceptation\n- x\n",
    extraFrontmatter: {},
  };
}

// `gh` is stubbed out so these tests never touch the network: `LITECODE_GH_BIN` points at a
// fake binary that either succeeds with canned JSON or always fails (offline).
async function fakeGh(root: string, script: string): Promise<string> {
  const bin = join(root, "fake-gh.sh");
  await Bun.write(bin, `#!/bin/sh\n${script}\n`);
  await sh(root, "chmod", "+x", bin);
  return bin;
}

test("a clean repo with no in-flight tickets has no findings", async () => {
  const root = await tmpRepo();
  const config = await exampleConfig({
    worktreeRoot: "../worktrees",
    domains: [{ match: "auth or input validation", skills: ["security-expert"] }],
  });
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toEqual([]);
});

test("an inProgress ticket with no worktree and no branch is reported", async () => {
  const root = await tmpRepo();
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toContainEqual({
    severity: "error",
    message: "0099-orphan: status inProgress but no worktree and no branch found — work may have been abandoned",
  });
});

test("an inProgress ticket with a matching branch is not reported as orphaned", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings.some((f) => f.message.includes("0099-orphan"))).toBe(false);
});

test("a worktree directory under worktreeRoot with no matching inProgress ticket is flagged stale", async () => {
  const root = await tmpRepo();
  await mkdir(join(root, "..", "worktrees"), { recursive: true });
  await sh(root, "git", "worktree", "add", "-q", "-b", "feat/thing/0099", join(root, "..", "worktrees", "0099"));
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toContainEqual({
    severity: "warn",
    message: expect.stringContaining("worktree at") as unknown as string,
  });
  const match = findings.find((f) => f.message.includes("worktrees/0099"));
  expect(match?.severity).toBe("warn");
  await sh(root, "git", "worktree", "remove", "-f", join(root, "..", "worktrees", "0099"));
});

test("a worktree for a review or readyToMerge ticket is not flagged stale (same-PR fixups happen there)", async () => {
  const root = await tmpRepo();
  await mkdir(join(root, "..", "worktrees"), { recursive: true });
  await sh(root, "git", "worktree", "add", "-q", "-b", "feat/thing/0099", join(root, "..", "worktrees", "0099"));
  await writeTicket(root, ticket("0099-orphan", "review"));
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings.some((f) => f.message.includes("worktrees/0099"))).toBe(false);
  await sh(root, "git", "worktree", "remove", "-f", join(root, "..", "worktrees", "0099"));
});

test("a pushed branch with no PR is reported once gh confirms it's missing", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  // Simulate "pushed" by making a bare remote.
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);
  await sh(root, "git", "push", "-q", "origin", "feat/thing/0099");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));

  const ghBin = await fakeGh(root, 'echo "[]"');
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings).toContainEqual({
      severity: "error",
      message: "0099-orphan: branch 'feat/thing/0099' is pushed but has no PR",
    });
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("gh being unavailable degrades the PR check to an unverified warning, not a hard failure", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);
  await sh(root, "git", "push", "-q", "origin", "feat/thing/0099");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));

  const ghBin = await fakeGh(root, 'echo "network unreachable" >&2; exit 1');
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    const unverified = findings.find((f) => f.message.includes("0099-orphan") && f.message.includes("non vérifié"));
    expect(unverified?.severity).toBe("warn");
    expect(findings.some((f) => f.severity === "error" && f.message.includes("0099-orphan"))).toBe(false);
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("gh not being installed at all (ENOENT) also degrades to unverified, not an uncaught crash", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);
  await sh(root, "git", "push", "-q", "origin", "feat/thing/0099");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));

  const prevGh = process.env.LITECODE_GH_BIN;
  // No binary at this path at all — `Bun.spawn` throws ENOENT synchronously, unlike a `gh`
  // that runs and exits non-zero (which `gh()` wraps in `GhError` itself).
  process.env.LITECODE_GH_BIN = join(root, "no-such-gh-binary");
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    const unverified = findings.find((f) => f.message.includes("0099-orphan") && f.message.includes("non vérifié"));
    expect(unverified?.severity).toBe("warn");
    expect(findings.some((f) => f.severity === "error" && f.message.includes("0099-orphan"))).toBe(false);
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("a review ticket whose PR is already merged is flagged stale", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);
  await sh(root, "git", "push", "-q", "origin", "feat/thing/0099");
  await writeTicket(root, ticket("0099-orphan", "review"));

  const ghBin = await fakeGh(
    root,
    `echo '[{"state":"MERGED","url":"https://github.com/o/r/pull/1"}]'`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings).toContainEqual({
      severity: "error",
      message: "0099-orphan: status 'review' but its PR (https://github.com/o/r/pull/1) is merged — update the ticket",
    });
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("an uncommitted change in the primary checkout identical to an open ticket branch is flagged as a leak", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "leaked content\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  // Simulate the leak: a sub-agent wrote the branch's exact content into the primary
  // checkout without committing it.
  await Bun.write(join(root, "a.txt"), "leaked content\n");

  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toContainEqual({
    severity: "error",
    message: "a.txt: uncommitted change in the primary checkout is identical to branch 'feat/thing/0099' (0099-orphan) — likely a leaked sub-agent write, discard it here",
  });
});

test("a leaked file inside a brand-new untracked directory is still flagged, not collapsed into a directory-only line", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await mkdir(join(root, "newdir"), { recursive: true });
  await Bun.write(join(root, "newdir", "b.txt"), "leaked content\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  // The directory itself is new and untracked in the primary checkout — a plain
  // `git status --porcelain` (without `--untracked-files=all`) would collapse this into a
  // single `?? newdir/` line and never surface the leaked file inside it.
  await mkdir(join(root, "newdir"), { recursive: true });
  await Bun.write(join(root, "newdir", "b.txt"), "leaked content\n");

  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toContainEqual({
    severity: "error",
    message: "newdir/b.txt: uncommitted change in the primary checkout is identical to branch 'feat/thing/0099' (0099-orphan) — likely a leaked sub-agent write, discard it here",
  });
});

test("an uncommitted change in the primary checkout that differs from the ticket branch is not flagged", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "branch content\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  // A human's own unrelated, legitimate edit in the primary checkout.
  await Bun.write(join(root, "a.txt"), "a human's own edit\n");

  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings.some((f) => f.message.includes("a.txt"))).toBe(false);
});

test("ticket doctor and config doctor findings are surfaced through the aggregate doctor", async () => {
  const root = await tmpRepo();
  // Malformed ticket file: no frontmatter delimiter, so `ticket doctor` reports a load error.
  await mkdir(join(root, "docs/tickets"), { recursive: true });
  await Bun.write(join(root, "docs/tickets/0001-broken.md"), "not frontmatter at all\n");
  const config = await exampleConfig();
  config.project.agentSkills = { tracker: [] };
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings.some((f) => f.message.includes("0001-broken.md"))).toBe(true);
  expect(findings.some((f) => f.message.includes("project.agentSkills") && f.message.includes("ignored"))).toBe(true);
});

function pendingAdrDraftBody(): string {
  return `
## ADR à valider : 0019

Draft awaiting approval.

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
}

test("a ticket blocked behind an unapproved ADR draft is flagged, with the ticket path to read it in", async () => {
  const root = await tmpRepo();
  const draft: Ticket = { ...ticket("0047-x", "inProgress"), body: pendingAdrDraftBody() };
  await writeTicket(root, draft);
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings).toContainEqual({
    severity: "warn",
    message:
      "0047-x: ADR draft awaiting approval (docs/decisions/0019-pending.md) — read/approve it in docs/tickets/0047-x.md",
  });
});

test("once the ADR is committed at adr_path, the ticket is no longer flagged", async () => {
  const root = await tmpRepo();
  const draft: Ticket = { ...ticket("0047-x", "inProgress"), body: pendingAdrDraftBody() };
  await writeTicket(root, draft);
  await mkdir(join(root, "docs/decisions"), { recursive: true });
  await Bun.write(join(root, "docs/decisions/0019-pending.md"), "# 0019. Pending decision\n\nStatus: accepted\n");
  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });
  expect(findings.some((f) => f.message.includes("ADR draft"))).toBe(false);
});

test("a ticket with an abandoned first branch (PR closed) and a live second branch (PR open) is not flagged stale", async () => {
  const root = await tmpRepo();
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-one/0099");
  await Bun.write(join(root, "a.txt"), "attempt one\n");
  await commitAll(root, "attempt one");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-one/0099");
  await sh(root, "git", "switch", "-q", "main");

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-two/0099");
  await Bun.write(join(root, "b.txt"), "attempt two\n");
  await commitAll(root, "attempt two");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-two/0099");
  await sh(root, "git", "switch", "-q", "main");

  await writeTicket(root, ticket("0099-orphan", "review"));

  const ghBin = await fakeGh(
    root,
    `case "$*" in
      *feat/attempt-one/0099*) echo '[{"state":"CLOSED","url":"https://github.com/o/r/pull/1"}]' ;;
      *feat/attempt-two/0099*) echo '[{"state":"OPEN","url":"https://github.com/o/r/pull/2"}]' ;;
      *) echo "[]" ;;
    esac`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings.some((f) => f.message.includes("0099-orphan") && f.message.includes("is closed"))).toBe(false);
    expect(findings.some((f) => f.message.includes("0099-orphan") && f.message.includes("is merged"))).toBe(false);
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("a merged PR whose remote branch was already deleted (gh pr merge --delete-branch) is still flagged stale", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  // No `git push` here at all: the local branch exists (as it would inside the ticket's own
  // worktree, still checked out), but the remote branch is gone — simulating
  // `gh pr merge --delete-branch` having already run. `remoteBranchExists` must not gate this
  // check, or the merged PR is silently masked.
  await writeTicket(root, ticket("0099-orphan", "review"));

  const ghBin = await fakeGh(
    root,
    `echo '[{"state":"MERGED","url":"https://github.com/o/r/pull/1"}]'`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings).toContainEqual({
      severity: "error",
      message: "0099-orphan: status 'review' but its PR (https://github.com/o/r/pull/1) is merged — update the ticket",
    });
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("doctor run from inside a ticket worktree resolves project.worktreeRoot relative to the primary checkout", async () => {
  const root = await tmpRepo();
  await mkdir(join(root, "..", "worktrees"), { recursive: true });
  // A stale worktree with no matching ticket at all — should be flagged regardless of which
  // worktree `doctor` itself is invoked from.
  await sh(root, "git", "worktree", "add", "-q", "-b", "feat/thing/0088", join(root, "..", "worktrees", "0088"));
  // The worktree `doctor` runs from — itself belongs to an inProgress ticket, so it must not
  // be flagged as stale against itself.
  await sh(root, "git", "worktree", "add", "-q", "-b", "feat/thing/0099", join(root, "..", "worktrees", "0099"));
  const config = await exampleConfig();
  const runningFromWorktree = join(root, "..", "worktrees", "0099");
  // Ticket status must be read against the primary checkout, not whichever worktree `doctor`
  // is invoked from — this is written (uncommitted) straight into the primary checkout, the
  // same way a real ticket status change lands before a branch is ever cut from it, and must
  // still be visible when `doctor` is run with `root` pointed at the ticket's own worktree.
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  const findings = await doctor({ root: runningFromWorktree, packsRoot: PACKS, config });

  expect(findings.some((f) => f.message.includes("worktrees/0088"))).toBe(true);
  expect(findings.some((f) => f.message.includes("worktrees/0099"))).toBe(false);

  await sh(root, "git", "worktree", "remove", "-f", join(root, "..", "worktrees", "0088"));
  await sh(root, "git", "worktree", "remove", "-f", join(root, "..", "worktrees", "0099"));
});

test("doctor run from inside a ticket worktree reads current ticket status from the primary checkout, not the worktree's stale copy", async () => {
  const root = await tmpRepo();
  // Ticket was `planned` (no status file entry needed here) when the branch was cut; it's
  // since moved to `inProgress`, committed on `main` in the primary checkout, per the real
  // `implementer` flow — the worktree's own checkout of `docs/tickets` predates that commit.
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await sh(root, "git", "switch", "-q", "main");
  await mkdir(join(root, "..", "worktrees"), { recursive: true });
  await sh(root, "git", "worktree", "add", "-q", join(root, "..", "worktrees", "0099"), "feat/thing/0099");
  await writeTicket(root, ticket("0099-orphan", "inProgress"));
  await commitAll(root, "move ticket to inProgress");

  const config = await exampleConfig();
  const runningFromWorktree = join(root, "..", "worktrees", "0099");
  const findings = await doctor({ root: runningFromWorktree, packsRoot: PACKS, config });

  // The worktree's own stale (pre-commit) copy of docs/tickets has no ticket at all, which
  // would make this worktree look orphaned (no matching inProgress ticket) if `doctor` read
  // ticket status from wherever it's invoked from instead of the primary checkout.
  expect(findings.some((f) => f.message.includes("worktrees/0099"))).toBe(false);

  await sh(root, "git", "worktree", "remove", "-f", join(root, "..", "worktrees", "0099"));
});

test("gh failing for one of a ticket's branches does not turn a sibling's closed PR into a false stale-status error", async () => {
  const root = await tmpRepo();
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-one/0099");
  await Bun.write(join(root, "a.txt"), "attempt one\n");
  await commitAll(root, "attempt one");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-one/0099");
  await sh(root, "git", "switch", "-q", "main");

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-two/0099");
  await Bun.write(join(root, "b.txt"), "attempt two\n");
  await commitAll(root, "attempt two");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-two/0099");
  await sh(root, "git", "switch", "-q", "main");

  await writeTicket(root, ticket("0099-orphan", "review"));

  // attempt-one's gh lookup succeeds and reports CLOSED; attempt-two's gh lookup fails
  // outright (simulating a transient gh error on the branch that might actually hold the
  // live, open PR) — the check must not conclude "closed" off attempt-one alone.
  const ghBin = await fakeGh(
    root,
    `case "$*" in
      *feat/attempt-one/0099*) echo '[{"state":"CLOSED","url":"https://github.com/o/r/pull/1"}]' ;;
      *feat/attempt-two/0099*) echo "network unreachable" >&2; exit 1 ;;
      *) echo "[]" ;;
    esac`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings.some((f) => f.severity === "error" && f.message.includes("0099-orphan"))).toBe(false);
    expect(findings.some((f) => f.message.includes("0099-orphan") && f.message.includes("non vérifié"))).toBe(true);
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("a MERGED branch is preferred over a sibling CLOSED branch when reporting a stale PR status", async () => {
  const root = await tmpRepo();
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-one/0099");
  await Bun.write(join(root, "a.txt"), "attempt one\n");
  await commitAll(root, "attempt one");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-one/0099");
  await sh(root, "git", "switch", "-q", "main");

  await sh(root, "git", "switch", "-q", "-c", "feat/attempt-two/0099");
  await Bun.write(join(root, "b.txt"), "attempt two\n");
  await commitAll(root, "attempt two");
  await sh(root, "git", "push", "-q", "origin", "feat/attempt-two/0099");
  await sh(root, "git", "switch", "-q", "main");

  await writeTicket(root, ticket("0099-orphan", "review"));

  const ghBin = await fakeGh(
    root,
    `case "$*" in
      *feat/attempt-one/0099*) echo '[{"state":"CLOSED","url":"https://github.com/o/r/pull/1"}]' ;;
      *feat/attempt-two/0099*) echo '[{"state":"MERGED","url":"https://github.com/o/r/pull/2"}]' ;;
      *) echo "[]" ;;
    esac`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    const findings = await doctor({ root, packsRoot: PACKS, config });
    expect(findings).toContainEqual({
      severity: "error",
      message: "0099-orphan: status 'review' but its PR (https://github.com/o/r/pull/2) is merged — update the ticket",
    });
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});

test("a prunable worktree (directory deleted, still registered) is not counted as present and is flagged to clean up", async () => {
  const root = await tmpRepo();
  await mkdir(join(root, "..", "worktrees"), { recursive: true });
  const wtPath = join(root, "..", "worktrees", "0099");
  await sh(root, "git", "worktree", "add", "-q", "-b", "feat/thing/0099", wtPath);
  await rm(wtPath, { recursive: true, force: true });
  await writeTicket(root, ticket("0099-orphan", "inProgress"));

  const config = await exampleConfig();
  const findings = await doctor({ root, packsRoot: PACKS, config });

  // Not counted as present: since the worktree is gone but a branch still matches the
  // ticket's number, it's not reported as fully abandoned either — only the prunable finding
  // fires.
  expect(findings.some((f) => f.message.includes("prunable"))).toBe(true);
  expect(findings.some((f) => f.message.includes("0099-orphan") && f.message.includes("abandoned"))).toBe(false);

  await sh(root, "git", "worktree", "prune");
});

test("gh pr list is called at most once per branch across checkPushedBranchWithoutPr and checkStalePrStatus", async () => {
  const root = await tmpRepo();
  await sh(root, "git", "switch", "-q", "-c", "feat/thing/0099");
  await Bun.write(join(root, "a.txt"), "x\n");
  await commitAll(root, "work");
  await sh(root, "git", "switch", "-q", "main");
  const bare = await mkdtemp(join(tmpdir(), "litecode-doctor-bare-"));
  dirs.push(bare);
  await sh(bare, "git", "init", "-q", "--bare");
  await sh(root, "git", "remote", "add", "origin", bare);
  await sh(root, "git", "push", "-q", "origin", "feat/thing/0099");
  // `review` makes both checkPushedBranchWithoutPr and checkStalePrStatus look at this branch.
  await writeTicket(root, ticket("0099-orphan", "review"));

  const callLog = join(root, "gh-calls.log");
  const ghBin = await fakeGh(
    root,
    `echo "$*" >> ${JSON.stringify(callLog)}\necho '[{"state":"OPEN","url":"https://github.com/o/r/pull/1"}]'`,
  );
  const prevGh = process.env.LITECODE_GH_BIN;
  process.env.LITECODE_GH_BIN = ghBin;
  try {
    const config = await exampleConfig();
    await doctor({ root, packsRoot: PACKS, config });
    const log = await Bun.file(callLog).text();
    const calls = log.split("\n").filter((l) => l.includes("pr list") && l.includes("feat/thing/0099"));
    expect(calls.length).toBe(1);
  } finally {
    if (prevGh === undefined) delete process.env.LITECODE_GH_BIN;
    else process.env.LITECODE_GH_BIN = prevGh;
  }
});
