import { expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan, applyPlan } from "../src/install.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

test("install tells the user when writing core.hooksPath fails (ticket 0058)", async () => {
  const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());
  const root = await mkdtemp(join(tmpdir(), "litecode-hookspath-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  await Bun.spawn(["git", "init", "-q"], { cwd: root }).exited;
  const plan = await buildPlan(root, PACKS, config);

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
  // git writes config through a lock file inside .git: a read-only .git makes `git config` fail.
  await chmod(join(root, ".git"), 0o555);
  try {
    await applyPlan(root, plan, "0.0.0-test", { force: false });
  } finally {
    await chmod(join(root, ".git"), 0o755);
    console.warn = originalWarn;
  }
  const text = warnings.join("\n");
  expect(text).toContain("core.hooksPath");
  expect(text).toMatch(/could not set|failed to set/i);
});
