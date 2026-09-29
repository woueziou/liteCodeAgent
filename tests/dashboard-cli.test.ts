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

async function runCliWithExit(cwd: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { output: plain(out + err), exitCode };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "litecode-dashboard-cli-"));
  await Bun.write(join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "bun test" } }));
  const path = await init(root, { yes: true, packsRoot: PACKS, targets: ["claude-code"] });
  const raw = ConfigSchema.parse(await Bun.file(path).json());
  raw.project.repo = "demo/demo";
  raw.project.checkCommand = "bun test";
  await Bun.write(path, `${JSON.stringify(raw, null, 2)}\n`);
  return root;
}

test("dashboard with neither --build nor --serve prints usage and exits 1 (documented breaking change)", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard"]);
  expect(exitCode).toBe(1);
  expect(output).not.toContain("dashboard requires --build");
  expect(output).toContain("litecodeagent dashboard");
});

test("dashboard --build and --serve together is a usage error, exit 1", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard", "--build", "--serve"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("--build");
  expect(output).toContain("--serve");
});

test("dashboard --build still writes docs/dashboard.html", async () => {
  const root = await project();
  const { exitCode } = await runCliWithExit(root, ["dashboard", "--build"]);
  expect(exitCode).toBe(0);
  const html = await Bun.file(join(root, "docs/dashboard.html")).text();
  expect(html).toContain("<!doctype html>");
});

test("dashboard --serve --port 70000 is rejected, not silently clamped (bug-hunter finding on PR 74)", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard", "--serve", "--port", "70000"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("70000");
});

test("dashboard --serve --allow-host '*' is rejected, not accepted as a wildcard (ticket 0052)", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard", "--serve", "--allow-host", "*"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("wildcard");
});

test("dashboard --serve --allow-host with no value errors instead of swallowing the next option (ticket 0058)", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard", "--serve", "--allow-host", "--port", "0"]);
  expect(exitCode).toBe(1);
  expect(output).toContain("--allow-host");
  expect(output).toMatch(/requires a value|missing value/);
});

test("dashboard --serve --allow-host as the last argument errors too (ticket 0058)", async () => {
  const root = await project();
  const { output, exitCode } = await runCliWithExit(root, ["dashboard", "--serve", "--allow-host"]);
  expect(exitCode).toBe(1);
  expect(output).toMatch(/requires a value|missing value/);
});
