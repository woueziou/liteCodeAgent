import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cli(root: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args, "--project", root], {
    cwd: root,
    env: { ...process.env, PATH: dirname(Bun.which("git")!) },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: (stdout + stderr).replace(/\x1b\[[0-9;]*m/g, ""), exitCode: await proc.exited };
}

/** An installed project; `deps` shapes the detected stack. */
async function installed(deps: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-doctor-"));
  scratch.push(root);
  await Bun.write(
    join(root, "package.json"),
    JSON.stringify({ name: "demo", scripts: { check: "tsc --noEmit" }, dependencies: deps }),
  );
  await Bun.spawn(["git", "init", "-b", "main"], { cwd: root, stdout: "ignore", stderr: "ignore" }).exited;
  const setup = await cli(root, ["setup", "--yes", "--targets", "claude-code", "--apply"]);
  expect(setup.exitCode, setup.out).toBe(0);
  return root;
}

async function editConfig(root: string, edit: (project: any) => void) {
  const path = join(root, "litecode.config.json");
  const config = await Bun.file(path).json();
  edit(config.project);
  await Bun.write(path, JSON.stringify(config, null, 2));
}

test("a routing rule naming a skill absent from the installed packs fails doctor", async () => {
  const root = await installed({ "@orpc/server": "1" });
  await editConfig(root, (p) => {
    p.domains = [{ match: "backend logic (oRPC)", skills: ["ghost-expert"] }];
  });
  const run = await cli(root, ["doctor"]);
  expect(run.exitCode).toBe(1);
  expect(run.out).toContain("ghost-expert");
  expect(run.out).toMatch(/not in the installed packs/);
});

test("doctor warns about a detected technology with no routing rule", async () => {
  const root = await installed({ "@orpc/server": "1" });
  await editConfig(root, (p) => {
    p.domains = [{ match: "visual layout", skills: ["security-expert"] }];
  });
  const run = await cli(root, ["doctor"]);
  expect(run.out).toMatch(/oRPC.*no routing rule/);
  expect(run.out).not.toContain("not in the installed packs");
});

test("doctor warns 'no routing rule' when the config has none", async () => {
  const root = await installed();
  await editConfig(root, (p) => {
    p.domains = [];
  });
  const run = await cli(root, ["doctor"]);
  expect(run.out).toContain("no routing rule");
  expect(run.exitCode).toBe(0);
});

test("doctor covers ticket checks that `ticket doctor` used to do", async () => {
  const root = await installed();
  await Bun.write(join(root, "docs/tickets/0001-broken.md"), "no frontmatter at all\n");
  const run = await cli(root, ["doctor"]);
  expect(run.exitCode).toBe(1);
  expect(run.out).toContain("0001-broken.md");
});

test("a config that still has agentSkills installs and doctor warns the key is ignored, with nothing to fix", async () => {
  const root = await installed();
  await editConfig(root, (p) => {
    p.agentSkills = { triage: ["typescript-expert"] };
  });
  const install = await cli(root, ["install", "--apply"]);
  expect(install.exitCode, install.out).toBe(0);
  const run = await cli(root, ["doctor"]);
  expect(run.out).toContain("project.agentSkills");
  expect(run.out).toMatch(/ignored/);
  expect(run.out).not.toContain("--fix to fill");
  expect(run.exitCode).toBe(0);
});

test("help no longer lists `ticket doctor` or `config doctor`", async () => {
  const root = await installed();
  const help = (await cli(root, ["--help"])).out;
  expect(help).not.toContain("ticket doctor");
  expect(help).not.toContain("config doctor");
  expect(help).toContain("litecode doctor");
});
