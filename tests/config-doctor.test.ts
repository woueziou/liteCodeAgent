import { expect, test } from "bun:test";
import { legacyExampleJson } from "./helpers/legacy-example.ts";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { doctor } from "../src/config-doctor.ts";

const PACKS = join(import.meta.dir, "..", "packs");

test("a config without agentSkills has no findings", async () => {
  const raw = await legacyExampleJson();
  delete raw.project.agentSkills;
  expect(await doctor(PACKS, ConfigSchema.parse(raw))).toEqual([]);
});

test("a config that still carries agentSkills is tolerated, and doctor warns the key is ignored", async () => {
  const findings = await doctor(PACKS, ConfigSchema.parse(await legacyExampleJson()));
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("warn");
  expect(findings[0]!.message).toContain("project.agentSkills");
  expect(findings[0]!.message).toMatch(/ignored/);
});

test("an empty agentSkills object is not worth a warning", async () => {
  const raw = await legacyExampleJson();
  raw.project.agentSkills = {};
  expect(await doctor(PACKS, ConfigSchema.parse(raw))).toEqual([]);
});
