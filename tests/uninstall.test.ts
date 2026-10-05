import { afterAll, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, LOCKFILE_NAME } from "../src/lockfile.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const HOOK_LOCK = ".githooks/.litecode-hook-lock.json";

const scratch: string[] = [];
/** Permission changes a test makes, undone before the scratch dirs are deleted. */
const undoers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const undo of undoers) await undo().catch(() => {});
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function run(cwd: string, args: string[]) {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { output: (out + err).replace(/\x1b\[[0-9;]*m/g, ""), exitCode: await proc.exited };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

/** A git project with the example config, its own skill, a ticket and an ADR, then `setup --apply`. */
async function installed(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-uninstall-"));
  scratch.push(root);
  await git(root, "init", "-q", "-b", "main");
  await Bun.write(join(root, "litecode.config.json"), await Bun.file(EXAMPLE).text());
  await Bun.write(join(root, ".claude/skills/orpc-expert/SKILL.md"), "---\nname: orpc-expert\n---\nmine\n");
  await Bun.write(
    join(root, "docs/tickets/0001-x.md"),
    "---\nschemaVersion: 2\nid: 0001-x\ntitle: X\nlabel: chore\nstatus: backlog\npriority: medium\nsize: small\nassignedAgent: human\ndueDate: \n---\n\nticket\n",
  );
  await Bun.write(join(root, "docs/decisions/0001-x.md"), "# 0001. X\n");
  const setup = await run(root, ["setup", "--apply"]);
  expect(setup.exitCode).toBe(0);
  return root;
}

async function snapshot(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries.filter((e) => !e.startsWith(".git/") && e !== ".git").sort();
}

type LockShape = { files: Record<string, { pack: string; version: string; hash: string }> };

/** Edits a lockfile in place, the way a tamperer (or a bug) would. */
async function mutateLock(root: string, edit: (lock: LockShape) => void, name = LOCKFILE_NAME): Promise<void> {
  const path = join(root, name);
  const lock = (await Bun.file(path).json()) as LockShape;
  edit(lock);
  await Bun.write(path, JSON.stringify(lock));
}

const lockEntry = (content: string) => ({ pack: "core", version: "1", hash: hash(content) });

async function chmodForTest(path: string, mode: number, back: number): Promise<void> {
  await chmod(path, mode);
  undoers.push(() => chmod(path, back));
}

async function lockedFiles(root: string): Promise<string[]> {
  const lock = (await Bun.file(join(root, LOCKFILE_NAME)).json()) as { files: Record<string, unknown> };
  return Object.keys(lock.files);
}

test("preview writes nothing, exits 0 and lists what it would remove", async () => {
  const root = await installed();
  const before = await snapshot(root);
  const { output, exitCode } = await run(root, ["uninstall"]);
  expect(exitCode).toBe(0);
  expect(await snapshot(root)).toEqual(before);
  expect(output).toContain("Would remove");
  expect(output).toContain(".claude/agents/");
  expect(output).toContain("--apply");
});

test("--apply removes generated files, lockfiles and emptied dirs, keeps the user's data and the config", async () => {
  const root = await installed();
  const { output, exitCode } = await run(root, ["uninstall", "--apply"]);
  expect(exitCode).toBe(0);
  expect(await exists(join(root, LOCKFILE_NAME))).toBe(false);
  expect(await exists(join(root, ".claude/agents"))).toBe(false);
  expect(await exists(join(root, ".githooks"))).toBe(false);
  expect(await Bun.file(join(root, ".claude/skills/orpc-expert/SKILL.md")).text()).toContain("mine");
  expect(await Bun.file(join(root, "docs/tickets/0001-x.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, "docs/decisions/0001-x.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, "litecode.config.json")).exists()).toBe(true);
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe("");
  expect(output).toContain("/plugin uninstall litecode-agent@litecode");
  expect(output).toContain("rm -rf ~/.litecode");
});

test("an edited file is kept and listed with the reason; --force removes it", async () => {
  const root = await installed();
  const [rel] = await lockedFiles(root);
  await Bun.write(join(root, rel!), "edited by hand\n");
  const first = await run(root, ["uninstall", "--apply"]);
  expect(first.exitCode).toBe(0);
  expect(await Bun.file(join(root, rel!)).text()).toBe("edited by hand\n");
  expect(first.output).toContain(rel!);
  expect(first.output).toMatch(/edited/);
  const second = await run(root, ["uninstall", "--apply", "--force"]);
  expect(second.exitCode).toBe(0);
  expect(await exists(join(root, rel!))).toBe(false);
  expect(await exists(join(root, LOCKFILE_NAME))).toBe(false);
});

test("--config removes litecode.config.json too", async () => {
  const root = await installed();
  await run(root, ["uninstall", "--apply", "--config"]);
  expect(await exists(join(root, "litecode.config.json"))).toBe(false);
});

test("an edited hook is kept and core.hooksPath stays", async () => {
  const root = await installed();
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe(".githooks");
  await Bun.write(join(root, ".githooks/pre-commit"), "#!/bin/sh\necho mine\n");
  const { output } = await run(root, ["uninstall", "--apply", "--force"]);
  expect(await Bun.file(join(root, ".githooks/pre-commit")).text()).toContain("mine");
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe(".githooks");
  expect(output).toContain("core.hooksPath");
});

test("a core.hooksPath the user set to something else is untouched", async () => {
  const root = await installed();
  await git(root, "config", "core.hooksPath", "my-hooks");
  const { output } = await run(root, ["uninstall", "--apply"]);
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe("my-hooks");
  expect(output).toContain("my-hooks");
});

test("a core.hooksPath of .githooks without litecode's hook lock is untouched", async () => {
  const root = await installed();
  await rm(join(root, HOOK_LOCK));
  const { output } = await run(root, ["uninstall", "--apply"]);
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe(".githooks");
  expect(await Bun.file(join(root, ".githooks/pre-commit")).exists()).toBe(true);
  expect(output).toContain("hook lock is absent");
});

test("a never-installed project: says so, exits 0, deletes nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "litecode-uninstall-none-"));
  scratch.push(root);
  await git(root, "init", "-q");
  await Bun.write(join(root, "litecode.config.json"), await Bun.file(EXAMPLE).text());
  await Bun.write(join(root, ".claude/skills/mine/SKILL.md"), "x\n");
  const before = await snapshot(root);
  const { output, exitCode } = await run(root, ["uninstall", "--apply", "--config", "--force"]);
  expect(exitCode).toBe(0);
  expect(output).toMatch(/no litecode install|no lockfile/i);
  expect(await snapshot(root)).toEqual(before);
});

test("a tampered lockfile with ../, absolute and symlinked-out paths deletes nothing outside the project", async () => {
  const root = await installed();
  const outside = await mkdtemp(join(tmpdir(), "litecode-uninstall-outside-"));
  scratch.push(outside);
  await Bun.write(join(outside, "victim.txt"), "keep me\n");
  await Bun.write(join(outside, "linked.txt"), "keep me too\n");
  await symlink(outside, join(root, "escape"));
  await mutateLock(root, (lock) => {
    lock.files[`../${outside.split("/").pop()}/victim.txt`] = lockEntry("keep me\n");
    lock.files[join(outside, "victim.txt")] = lockEntry("keep me\n");
    lock.files["escape/linked.txt"] = lockEntry("keep me too\n");
  });
  const { output, exitCode } = await run(root, ["uninstall", "--apply", "--force"]);
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(outside, "victim.txt")).text()).toBe("keep me\n");
  expect(await Bun.file(join(outside, "linked.txt")).text()).toBe("keep me too\n");
  expect(output).toMatch(/outside the project/);
});

test("a lockfile entry naming docs/tickets or docs/decisions is never deleted", async () => {
  const root = await installed();
  await mutateLock(root, (lock) => {
    lock.files["docs/tickets/0001-x.md"] = lockEntry("x");
    lock.files["docs/decisions/0001-x.md"] = lockEntry("# 0001. X\n");
  });
  await run(root, ["uninstall", "--apply", "--force"]);
  expect(await exists(join(root, "docs/tickets/0001-x.md"))).toBe(true);
  expect(await exists(join(root, "docs/decisions/0001-x.md"))).toBe(true);
});

test("a directory that still holds a user file is not removed", async () => {
  const root = await installed();
  await Bun.write(join(root, ".claude/agents/my-own-agent.md"), "mine\n");
  await run(root, ["uninstall", "--apply"]);
  expect(await Bun.file(join(root, ".claude/agents/my-own-agent.md")).text()).toBe("mine\n");
});

test("remaining agent branches are listed with how to remove them, never removed", async () => {
  const root = await installed();
  await git(root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--allow-empty", "-m", "init");
  await git(root, "branch", "feat/0007");
  const { output } = await run(root, ["uninstall", "--apply"]);
  expect(output).toContain("git branch -D feat/0007");
  expect(await git(root, "branch", "--list", "feat/0007")).toContain("feat/0007");
});

test("setup --apply after uninstall --apply gives a consistent project: doctor reports nothing", async () => {
  const root = await installed();
  await run(root, ["uninstall", "--apply"]);
  const again = await run(root, ["setup", "--apply"]);
  expect(again.exitCode).toBe(0);
  expect(await exists(join(root, LOCKFILE_NAME))).toBe(true);
  const doctor = await run(root, ["doctor"]);
  expect(doctor.exitCode).toBe(0);
  expect(doctor.output).toContain("Nothing to report");
});

test("litecode --help lists uninstall in the Install group", async () => {
  const { output } = await run(tmpdir(), ["--help"]);
  const install = output.indexOf("Install");
  const plan = output.indexOf("\nPlan");
  const at = output.indexOf("litecode uninstall");
  expect(at).toBeGreaterThan(install);
  expect(at).toBeLessThan(plan);
});

const REFUSED = "outside the directories litecode writes to";

test("a lockfile cannot widen the reach: .git, root files and the config are refused, with or without --force", async () => {
  const root = await installed();
  const files: Record<string, string> = {
    "package.json": '{"name":"mine"}\n',
    "README.md": "# mine\n",
    ".git/HEAD": await Bun.file(join(root, ".git/HEAD")).text(),
    ".git/config": await Bun.file(join(root, ".git/config")).text(),
    "litecode.config.json": await Bun.file(join(root, "litecode.config.json")).text(),
    "src/app.ts": "export {};\n",
  };
  for (const [rel, content] of Object.entries(files)) await Bun.write(join(root, rel), content);
  // Both shapes of tampering: a made-up hash and the file's real hash.
  await mutateLock(root, (lock) => {
    for (const [rel, content] of Object.entries(files)) {
      lock.files[rel] = rel.endsWith("HEAD") || rel === "README.md" ? lockEntry(content) : { pack: "core", version: "1", hash: "x" };
    }
  });
  for (const args of [["uninstall"], ["uninstall", "--apply"], ["uninstall", "--apply", "--force"]]) {
    const { output } = await run(root, args);
    expect(output).toContain(REFUSED);
    for (const [rel, content] of Object.entries(files)) {
      // .git/config is the one file uninstall legitimately edits (it unsets core.hooksPath it set).
      if (rel === ".git/config") expect(await exists(join(root, rel))).toBe(true);
      else expect(await Bun.file(join(root, rel)).text()).toBe(content);
    }
  }
});

test("the installed hook is removable through its own lock only, never through a target lockfile", async () => {
  const root = await installed();
  await mutateLock(root, (lock) => {
    lock.files[".githooks/pre-commit"] = lockEntry("whatever");
  });
  const { output } = await run(root, ["uninstall", "--apply", "--force"]);
  expect(output).toContain(REFUSED);
});

test("an entry under a configured tickets dir is never deleted, even inside an output root", async () => {
  const root = await installed();
  const config = JSON.parse(await Bun.file(join(root, "litecode.config.json")).text());
  config.project.tickets = { ...(config.project.tickets ?? {}), dir: ".claude/work" };
  await Bun.write(join(root, "litecode.config.json"), JSON.stringify(config));
  await Bun.write(join(root, ".claude/work/0002-y.md"), "ticket\n");
  await mutateLock(root, (lock) => {
    lock.files[".claude/work/0002-y.md"] = lockEntry("ticket\n");
  });
  await run(root, ["uninstall", "--apply", "--force"]);
  expect(await Bun.file(join(root, ".claude/work/0002-y.md")).text()).toBe("ticket\n");
});

test("a generated file replaced by a symlink to a directory does not crash; --force unlinks the link only", async () => {
  const root = await installed();
  const target = await mkdtemp(join(tmpdir(), "litecode-uninstall-linkdir-"));
  scratch.push(target);
  await Bun.write(join(target, "precious.txt"), "keep\n");
  const agent = join(root, ".claude/agents/orchestrator.md");
  await rm(agent);
  await symlink(target, agent);
  const preview = await run(root, ["uninstall"]);
  expect(preview.exitCode).toBe(0);
  expect(preview.output).toContain("not a regular file");
  const applied = await run(root, ["uninstall", "--apply"]);
  expect(applied.exitCode).toBe(0);
  expect(await readlink(agent)).toBe(target);
  const forced = await run(root, ["uninstall", "--apply", "--force"]);
  expect(forced.exitCode).toBe(0);
  expect(await exists(agent)).toBe(false);
  expect(await Bun.file(join(target, "precious.txt")).text()).toBe("keep\n");
});

test("an unreadable file is kept with its reason and the run goes on; a preview completes", async () => {
  const root = await installed();
  const [rel] = await lockedFiles(root);
  const locked = join(root, rel!);
  await chmodForTest(locked, 0o000, 0o644);
  const preview = await run(root, ["uninstall"]);
  expect(preview.exitCode).toBe(0);
  expect(preview.output).toContain("cannot be read: EACCES");
  const applied = await run(root, ["uninstall", "--apply"]);
  expect(applied.exitCode).toBe(1);
  expect(applied.output).toContain(`${rel}: cannot be read: EACCES`);
  expect(await exists(locked)).toBe(true);
  // Every other generated file went; only the unreadable one is still vouched for.
  expect(await lockedFiles(root)).toEqual([rel!]);
});

test("a removal that fails is reported and the exit code is 1, never 'Uninstalled.'", async () => {
  const root = await installed();
  const dir = join(root, ".claude/agents");
  await chmodForTest(dir, 0o555, 0o755);
  const { output, exitCode } = await run(root, ["uninstall", "--apply"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("Failed:");
  expect(output).not.toContain("Uninstalled.");
  expect(await exists(join(root, LOCKFILE_NAME))).toBe(true);
});

test("a lockfile that is not valid JSON is reported as unreadable, exit 1, nothing deleted", async () => {
  const root = await installed();
  await Bun.write(join(root, LOCKFILE_NAME), "{ not json");
  const before = await snapshot(root);
  for (const args of [["uninstall"], ["uninstall", "--apply", "--force"]]) {
    const { output, exitCode } = await run(root, args);
    expect(exitCode).toBe(1);
    expect(output).toContain(LOCKFILE_NAME);
    expect(output).toMatch(/unreadable/i);
    expect(output).not.toMatch(/no litecode install/i);
    expect(await snapshot(root)).toEqual(before);
  }
});

test("unknown options fail with exit 2 and a usage line before anything is touched", async () => {
  const root = await installed();
  const before = await snapshot(root);
  for (const bad of ["--aply", "--forc", "--yes", "--apply=true", "stray"]) {
    const { output, exitCode } = await run(root, ["uninstall", "--apply", bad]);
    expect(exitCode).toBe(2);
    expect(output).toContain(bad);
    expect(output).toContain("Usage: litecode uninstall [--apply] [--force] [--config]");
    expect(await snapshot(root)).toEqual(before);
  }
});

test("--yes is gone from the help", async () => {
  const { output } = await run(tmpdir(), ["--help"]);
  const at = output.indexOf("litecode uninstall");
  expect(output.slice(at, output.indexOf("\nPlan"))).not.toContain("--yes");
});

test("the outside notice prints only after an --apply that ran", async () => {
  const root = await installed();
  const preview = await run(root, ["uninstall"]);
  expect(preview.output).not.toContain("Outside this project");
  const none = await mkdtemp(join(tmpdir(), "litecode-uninstall-none-"));
  scratch.push(none);
  await git(none, "init", "-q");
  const nothing = await run(none, ["uninstall", "--apply"]);
  expect(nothing.output).not.toContain("Outside this project");
  const applied = await run(root, ["uninstall", "--apply"]);
  expect(applied.output).toContain("Outside this project");
});

test("other files in .githooks keep running: the hook goes, core.hooksPath stays", async () => {
  const root = await installed();
  await Bun.write(join(root, ".githooks/commit-msg"), "#!/bin/sh\n");
  const { output } = await run(root, ["uninstall", "--apply"]);
  expect(await exists(join(root, ".githooks/pre-commit"))).toBe(false);
  expect(await exists(join(root, ".githooks/commit-msg"))).toBe(true);
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe(".githooks");
  expect(output).toContain("other files remain");
});

test("an agent worktree is listed with its removal command, never removed", async () => {
  const root = await installed();
  const wtRoot = await mkdtemp(join(tmpdir(), "litecode-uninstall-wt-"));
  scratch.push(wtRoot);
  const config = JSON.parse(await Bun.file(join(root, "litecode.config.json")).text());
  config.project.worktreeRoot = wtRoot;
  await Bun.write(join(root, "litecode.config.json"), JSON.stringify(config));
  await git(root, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "--allow-empty", "-m", "init");
  await git(root, "worktree", "add", "-q", join(wtRoot, "0007"), "-b", "feat/0007");
  const { output } = await run(root, ["uninstall", "--apply"]);
  expect(output).toContain("git worktree remove");
  expect(output).toContain("0007");
  expect(await exists(join(wtRoot, "0007"))).toBe(true);
});
