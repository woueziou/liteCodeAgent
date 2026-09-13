import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";
import { parseFrontmatter } from "../src/frontmatter.ts";

const PACKS = join(import.meta.dir, "..", "packs");

test("every pack loads and declares a version", async () => {
  const names = await listPacks(PACKS);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    const pack = await loadPack(PACKS, name);
    expect(pack.manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  }
});

test("no pack file hardcodes a project literal", async () => {
  // The whole point of the packs is portability: a literal that only makes sense on one
  // repo belongs in that repo's config, not in a shared pack.
  const forbidden = [/kp-dev-org/, /ts-employee-service/, /@service\//, /apps\/web/, /bun --filter/];
  const leaks: string[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files) {
      for (const pattern of forbidden) {
        if (pattern.test(file.source)) leaks.push(`${name}/${file.rel} contains ${pattern}`);
      }
    }
  }
  expect(leaks).toEqual([]);
});

test("packs declare a capability tier, never a concrete model", async () => {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files.filter((f) => f.rel.startsWith("agents/"))) {
      const { data } = parseFrontmatter(file.source, file.rel);
      expect(data.model).toBeUndefined();
      expect(data.tier ?? "(missing)").toMatch(/^(fast|balanced|reasoning)$/);
    }
  }
});

test("every agent and skill declares a name and description", async () => {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files) {
      const { data } = parseFrontmatter(file.source, `${name}/${file.rel}`);
      expect(data.name, `${name}/${file.rel} name`).toBeTruthy();
      expect(data.description, `${name}/${file.rel} description`).toBeTruthy();
    }
  }
});
