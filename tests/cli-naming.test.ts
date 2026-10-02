import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-naming-"));
  scratch.push(root);
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { check: "tsc --noEmit" } }));
  const git = Bun.spawn(["git", "init", "-b", "main"], { cwd: root, stdout: "ignore", stderr: "ignore" });
  await git.exited;
  return root;
}

async function cli(root: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--project", root], {
    cwd: root,
    env: { ...process.env, PATH: dirname(Bun.which("git")!) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, exitCode: await proc.exited };
}

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("help is grouped by workflow stage and names the command litecode", async () => {
  const root = await project();
  const run = await cli(root, ["--help"]);
  const out = strip(run.stdout);
  expect(run.exitCode).toBe(0);

  const stages = ["Install", "Plan", "Implement", "Diagnose"].map((s) => out.indexOf(`\n${s}\n`));
  expect(stages.every((i) => i >= 0)).toBe(true);
  expect([...stages].sort((a, b) => a - b)).toEqual(stages);

  expect(out).toContain("litecode upgrade");
  expect(out).toContain("bunx litecodeagent setup");
  // `litecodeagent` survives only on the first-install line.
  const offenders = out.split("\n").filter((l) => l.includes("litecodeagent") && !l.includes("setup"));
  expect(offenders).toEqual([]);
});

test("help lists no `install` command, and `--check` stays reachable for CI", async () => {
  const root = await project();
  const out = strip((await cli(root, ["--help"])).stdout);
  expect(out).not.toMatch(/litecode install\b/);
  expect(out).toContain("--check");

  expect((await cli(root, ["setup", "--yes", "--targets", "claude-code", "--apply"])).exitCode).toBe(0);
  const check = await cli(root, ["install", "--check"]);
  expect(check.exitCode, check.stdout + check.stderr).toBe(0);
});

test("setup announces `litecode upgrade` and installs the /litecode command", async () => {
  const root = await project();
  const run = await cli(root, ["setup", "--yes", "--targets", "claude-code", "--apply"]);
  expect(run.exitCode, run.stderr).toBe(0);
  expect(strip(run.stdout)).toContain("litecode upgrade");
  expect(await Bun.file(join(root, ".claude/commands/litecode.md")).exists()).toBe(true);
  expect(await Bun.file(join(root, ".claude/commands/litecodeagent.md")).exists()).toBe(false);
});

test("a project behind the installed version is flagged at launch, an up-to-date one is not", async () => {
  const root = await project();
  await cli(root, ["setup", "--yes", "--targets", "claude-code", "--apply"]);

  const current = await cli(root, ["status"]);
  expect(strip(current.stdout + current.stderr)).not.toContain("behind");

  const lockPath = join(root, ".claude/.litecode-lock.json");
  const lock = await Bun.file(lockPath).json();
  await Bun.write(lockPath, JSON.stringify({ ...lock, litecodeVersion: "0.0.1" }));

  const behind = await cli(root, ["status"]);
  const text = strip(behind.stdout + behind.stderr);
  expect(text).toContain("0.0.1");
  expect(text).toContain("litecode upgrade");

  const upgrade = await cli(root, ["upgrade", "--yes", "--no-self-update"]);
  expect(strip(upgrade.stderr)).not.toContain("behind");
});
