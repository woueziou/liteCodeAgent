import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan, applyPlan } from "../src/install.ts";
import { readLockfile } from "../src/lockfile.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

async function exampleConfig() {
  return ConfigSchema.parse(await Bun.file(EXAMPLE).json());
}

test("the shipped example config is valid", async () => {
  await expect(exampleConfig()).resolves.toBeDefined();
});

test("a full render produces no unresolved template syntax", async () => {
  const config = await exampleConfig();
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  const plan = await buildPlan(root, PACKS, config);
  expect(plan.entries.length).toBeGreaterThan(20);
  for (const entry of plan.entries) {
    expect(`${entry.rel}:${entry.content.includes("{{")}`).toBe(`${entry.rel}:false`);
    expect(entry.status).toBe("create");
  }
});

test("install writes a lockfile that owns only what it rendered", async () => {
  const config = await exampleConfig();
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  const plan = await buildPlan(root, PACKS, config);
  await applyPlan(root, plan, "0.0.0-test", { force: false });

  const lock = await readLockfile(root);
  expect(lock).not.toBeNull();
  expect(Object.keys(lock!.files).length).toBe(plan.entries.length);
  expect(lock!.packs).toEqual({ core: "0.1.0", web: "0.1.0" });

  // A file the project owns is invisible to the kit.
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "local overlay\n");
  const second = await buildPlan(root, PACKS, config);
  expect(second.orphans).toEqual([]);
  expect(second.entries.every((e) => e.status === "unchanged")).toBe(true);
});

test("a hand-edited managed file is reported as drift and never silently overwritten", async () => {
  const config = await exampleConfig();
  const root = await mkdtemp(join(tmpdir(), "litecode-"));
  await applyPlan(root, await buildPlan(root, PACKS, config), "0.0.0-test", { force: false });

  const victim = join(root, ".claude", "agents", "planner.md");
  await Bun.write(victim, `${await Bun.file(victim).text()}\n<!-- local tweak -->\n`);

  const plan = await buildPlan(root, PACKS, config);
  expect(plan.entries.find((e) => e.rel.endsWith("planner.md"))!.status).toBe("drift");
  await expect(applyPlan(root, plan, "0.0.0-test", { force: false })).rejects.toThrow(/hand/);
  await applyPlan(root, plan, "0.0.0-test", { force: true });
  expect(await Bun.file(victim).text()).not.toContain("local tweak");
});
