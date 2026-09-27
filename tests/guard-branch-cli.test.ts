import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/init.ts";
import { ConfigSchema } from "../src/config.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const PACKS = join(import.meta.dir, "..", "packs");

function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runCliWithExit(cwd: string, args: string[], env: Record<string, string | undefined> = {}): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: plain(out + err), exitCode };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-guard-branch-cli-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo" }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  raw.project.defaultBranch = "main";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  await Bun.spawn(["git", "init", "-q", "-b", "main"], { cwd: root }).exited;
  return root;
}

test("guard-branch exits 1 on the default branch", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["guard-branch"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/refusing to commit/i);
});

test("guard-branch exits 0 on a feature branch", async () => {
  const root = await project();
  await Bun.spawn(["git", "checkout", "-q", "-b", "feat/x"], { cwd: root }).exited;
  const { exitCode } = await runCliWithExit(root, ["guard-branch"]);
  expect(exitCode).toBe(0);
});

test("guard-branch exits 0 on the default branch when project.allowDefaultBranchCommits is true", async () => {
  const root = await project();
  const configPath = join(root, "litecode.config.json");
  const raw = await Bun.file(configPath).json();
  raw.project.allowDefaultBranchCommits = true;
  await Bun.write(configPath, `${JSON.stringify(raw, null, 2)}\n`);
  const { exitCode } = await runCliWithExit(root, ["guard-branch"]);
  expect(exitCode).toBe(0);
});

test("guard-branch exits 0 on the default branch when LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT is set", async () => {
  const root = await project();
  const { exitCode } = await runCliWithExit(root, ["guard-branch"], { LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT: "1" });
  expect(exitCode).toBe(0);
});

test("guard-branch exits 0 on the default branch when only ticket files are staged", async () => {
  const root = await project();
  await Bun.write(join(root, "docs", "tickets", "0001-x.md"), "x\n");
  await Bun.spawn(["git", "add", "docs/tickets/0001-x.md"], { cwd: root }).exited;
  const { exitCode } = await runCliWithExit(root, ["guard-branch"]);
  expect(exitCode).toBe(0);
});

test("guard-branch exits 1 on the default branch when a ticket is staged with another file", async () => {
  const root = await project();
  await Bun.write(join(root, "docs", "tickets", "0001-x.md"), "x\n");
  await Bun.write(join(root, "src.ts"), "x\n");
  await Bun.spawn(["git", "add", "docs/tickets/0001-x.md", "src.ts"], { cwd: root }).exited;
  const { output, exitCode } = await runCliWithExit(root, ["guard-branch"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/only ticket files/i);
});
