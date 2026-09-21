import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { init } from "../src/init.ts";

const ROOT = join(import.meta.dir, "..");
const PACKS = join(ROOT, "packs");

async function run(command: string[], cwd = ROOT, env?: Record<string, string | undefined>) {
  const proc = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("the npm package exposes the exact bunx command and the legacy alias", async () => {
  const pkg = await Bun.file(join(ROOT, "package.json")).json();

  expect(pkg.name).toBe("litecodeagent");
  expect(pkg.bin).toEqual({
    litecodeagent: "./bin/litecodeagent",
    litecode: "./bin/litecode",
  });
  expect(pkg.publishConfig).toEqual({ access: "public" });
});

test("the packed npm artifact contains the complete runtime and executes", async () => {
  const output = await mkdtemp(join(tmpdir(), "litecode-pack-"));
  try {
    const packed = await run(["bun", "pm", "pack", "--destination", output, "--quiet"]);
    expect(packed.exitCode, packed.stderr).toBe(0);
    const filename = packed.stdout.trim().split("\n").at(-1)!;
    const archive = isAbsolute(filename) ? filename : join(output, filename);

    const listed = await run(["tar", "-tzf", archive]);
    expect(listed.exitCode, listed.stderr).toBe(0);
    const files = listed.stdout.trim().split("\n");
    expect(files).toContain("package/bin/litecodeagent");
    expect(files).toContain("package/bin/litecode");
    expect(files).toContain("package/src/cli.ts");
    expect(files).toContain("package/packs/core/pack.json");
    expect(files).toContain("package/.claude-plugin/plugin.json");
    expect(files.some((file) => file.startsWith("package/tests/"))).toBe(false);
    expect(files.some((file) => file.startsWith("package/node_modules/"))).toBe(false);

    const extracted = join(output, "extracted");
    await mkdir(extracted);
    const unpacked = await run(["tar", "-xzf", archive, "-C", extracted]);
    expect(unpacked.exitCode, unpacked.stderr).toBe(0);
    const invoked = await run(
      ["bun", join(extracted, "package/bin/litecodeagent"), "--version"],
      extracted,
      { ...process.env, NODE_PATH: join(ROOT, "node_modules") },
    );
    expect(invoked.exitCode, invoked.stderr).toBe(0);
    const version = (await Bun.file(join(ROOT, "package.json")).json()).version;
    expect(invoked.stdout.trim()).toBe(version);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("setup reuses a config and keeps install dry-run semantics", async () => {
  const project = await mkdtemp(join(tmpdir(), "litecode-setup-"));
  try {
    await Bun.write(
      join(project, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "bun test" } }),
    );
    await init(project, { yes: true, packsRoot: PACKS });
    const configPath = join(project, "litecode.config.json");
    const config = await Bun.file(configPath).json();
    config.project.repo = "demo/demo";
    await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const preview = await run(["bun", join(ROOT, "src/cli.ts"), "setup", "--project", project]);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("Dry run");
    expect(await Bun.file(join(project, ".claude/.litecode-lock.json")).exists()).toBe(false);

    const applied = await run([
      "bun",
      join(ROOT, "src/cli.ts"),
      "setup",
      "--apply",
      "--project",
      project,
    ]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("Installed.");
    expect(await Bun.file(join(project, ".claude/.litecode-lock.json")).exists()).toBe(true);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
