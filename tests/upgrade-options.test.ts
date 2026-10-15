import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

// `litecode upgrade` changes files when it gets `--yes`. A mistyped option used to be ignored
// silently: `--yez` ran as a plan-only call, and a misspelled `--no-self-update` ran the
// self-update the caller meant to skip. It must fail loudly, before it touches anything.

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-upgrade-opts-"));
  scratch.push(root);
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { check: "tsc --noEmit" } }));
  const git = Bun.spawn(["git", "init", "-b", "main"], { cwd: root, stdout: "ignore", stderr: "ignore" });
  await git.exited;
  return root;
}

async function cli(root: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: root,
    env: { ...process.env, PATH: dirname(Bun.which("git")!) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout: stdout.replace(/\u001b\[[0-9;]*m/g, ""), stderr, exitCode: await proc.exited };
}

test("a mistyped option is rejected with exit 2 and a usage line, before anything runs", async () => {
  const root = await project();
  for (const bad of ["--yez", "--yes=1", "--no-self-updat", "--force", "-x"]) {
    const run = await cli(root, ["upgrade", bad, "--no-self-update", "--project", root]);
    expect({ bad, code: run.exitCode }).toEqual({ bad, code: 2 });
    expect(run.stdout).toContain(bad);
    expect(run.stdout).toMatch(/litecode upgrade \[--yes\]/);
    // No plan was printed: the check ran before the project was even read.
    expect(run.stdout).not.toContain("Project");
  }
});

test("a mistyped self-update option does not start the self-update", async () => {
  const root = await project();
  // If `--no-self-updat` were ignored, the command would try to update the kit checkout.
  const run = await cli(root, ["upgrade", "--no-self-updat", "--project", root]);
  expect(run.exitCode).toBe(2);
  expect(run.stdout).not.toContain("Continuing with the updated version");
  expect(run.stdout).not.toContain("Could not update litecode itself");
});

test("a stray positional argument is rejected too", async () => {
  const root = await project();
  const run = await cli(root, ["upgrade", "everything", "--no-self-update", "--project", root]);
  expect(run.exitCode).toBe(2);
  expect(run.stdout).toContain("everything");
});

test("the documented options are still accepted, with --project", async () => {
  const root = await project();
  for (const args of [
    ["upgrade", "--no-self-update", "--project", root],
    ["upgrade", "--yes", "--no-self-update", "--project", root],
    ["upgrade", "-y", "--no-self-update", "--project", root],
  ]) {
    const run = await cli(root, args);
    // No config in this project: "nothing to upgrade" is a clean 0, not a usage error.
    expect({ args, code: run.exitCode }).toEqual({ args, code: 0 });
    expect(run.stdout).toContain("nothing to upgrade");
  }
});
