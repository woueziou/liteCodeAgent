import { afterAll, expect, test } from "bun:test";
import { lstat, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, LOCKFILE_NAME } from "../src/lockfile.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const HOOK_LOCK = ".githooks/.litecode-hook-lock.json";

const scratch: string[] = [];
afterAll(async () => {
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
  await run(root, ["uninstall", "--apply"]);
  expect(await git(root, "config", "--get", "core.hooksPath")).toBe(".githooks");
  expect(await Bun.file(join(root, ".githooks/pre-commit")).exists()).toBe(true);
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
  const lockPath = join(root, LOCKFILE_NAME);
  const lock = (await Bun.file(lockPath).json()) as { files: Record<string, { pack: string; version: string; hash: string }> };
  const entry = (content: string) => ({ pack: "core", version: "1", hash: hash(content) });
  lock.files[`../${outside.split("/").pop()}/victim.txt`] = entry("keep me\n");
  lock.files[join(outside, "victim.txt")] = entry("keep me\n");
  lock.files["escape/linked.txt"] = entry("keep me too\n");
  await Bun.write(lockPath, JSON.stringify(lock));
  const { output, exitCode } = await run(root, ["uninstall", "--apply", "--force"]);
  expect(exitCode).toBe(0);
  expect(await Bun.file(join(outside, "victim.txt")).text()).toBe("keep me\n");
  expect(await Bun.file(join(outside, "linked.txt")).text()).toBe("keep me too\n");
  expect(output).toMatch(/outside the project/);
});

test("a lockfile entry naming docs/tickets or docs/decisions is never deleted", async () => {
  const root = await installed();
  const lockPath = join(root, LOCKFILE_NAME);
  const lock = (await Bun.file(lockPath).json()) as { files: Record<string, unknown> };
  lock.files["docs/tickets/0001-x.md"] = { pack: "core", version: "1", hash: hash("x") };
  lock.files["docs/decisions/0001-x.md"] = { pack: "core", version: "1", hash: hash("# 0001. X\n") };
  await Bun.write(lockPath, JSON.stringify(lock));
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
  expect(doctor.output).not.toMatch(/\berror\b/);
  expect(doctor.output).not.toMatch(/drift/i);
});

test("litecode --help lists uninstall in the Install group", async () => {
  const { output } = await run(tmpdir(), ["--help"]);
  const install = output.indexOf("Install");
  const plan = output.indexOf("\nPlan");
  const at = output.indexOf("litecode uninstall");
  expect(at).toBeGreaterThan(install);
  expect(at).toBeLessThan(plan);
});
