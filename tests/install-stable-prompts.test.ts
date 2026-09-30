import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { buildPlan, applyPlan } from "../src/install.ts";

const PACKS = join(import.meta.dir, "..", "packs");
const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");

async function installAndRead(): Promise<Record<string, string>> {
  const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());
  const root = await mkdtemp(join(tmpdir(), "litecode-stable-"));
  await Bun.write(join(root, ".claude", "skills", "orpc-expert", "SKILL.md"), "---\nname: orpc-expert\n---\n");
  await applyPlan(root, await buildPlan(root, PACKS, config), "9.9.9", { force: false });
  const files: Record<string, string> = {};
  for await (const rel of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
    if (rel.includes("lock")) continue;
    if (!/(^|\/)(agents|skills)\//.test(rel)) continue;
    files[rel] = await Bun.file(join(root, rel)).text();
  }
  return files;
}

test("two installs at different instants render byte-identical agent and skill files", async () => {
  const first = await installAndRead();
  await Bun.sleep(1100);
  const second = await installAndRead();
  expect(Object.keys(first).length).toBeGreaterThan(0);
  expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
  for (const [rel, text] of Object.entries(first)) expect(second[rel]).toBe(text);
});
