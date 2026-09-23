import { expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { doctor, findMissingAgentSkills, computeAgentSkillsFix } from "../src/config-doctor.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

async function exampleConfig() {
  return ConfigSchema.parse(await Bun.file(EXAMPLE).json());
}

test("a fully populated config has no findings", async () => {
  const config = await exampleConfig();
  expect(await doctor(PACKS, config)).toEqual([]);
});

test("a missing agentSkills key is reported with the referencing pack file", async () => {
  const config = await exampleConfig();
  delete (config.project.agentSkills as Record<string, string[]>).tracker;
  const missing = await findMissingAgentSkills(PACKS, config);
  expect(missing.map((m) => m.path)).toContain("project.agentSkills.tracker");
  const entry = missing.find((m) => m.path === "project.agentSkills.tracker")!;
  expect(entry.sources.some((s) => s.includes("agents/tracker.md"))).toBe(true);
});

test("a present-but-empty agentSkills key is not reported as missing", async () => {
  const config = await exampleConfig();
  (config.project.agentSkills as Record<string, string[]>).tracker = [];
  expect(await findMissingAgentSkills(PACKS, config)).toEqual([]);
});

test("computeAgentSkillsFix derives values for exactly the missing keys, nothing else", async () => {
  const config = await exampleConfig();
  const before = { ...config.project.agentSkills };
  delete (config.project.agentSkills as Record<string, string[]>).tracker;
  const fix = await computeAgentSkillsFix(PACKS, config);
  expect(Object.keys(fix)).toEqual(["tracker"]);
  expect(fix.tracker).toEqual(before.tracker);
});

test("computeAgentSkillsFix is a no-op when nothing is missing", async () => {
  const config = await exampleConfig();
  expect(await computeAgentSkillsFix(PACKS, config)).toEqual({});
});
