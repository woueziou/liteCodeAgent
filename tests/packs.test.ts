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

test("every `project.language` reference in a pack file is behind {{#if project.language}}", async () => {
  const openTag = "{{#if project.language}}";
  const closeTag = "{{/if}}";
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files) {
      const src = file.source;
      if (!src.includes("project.language")) continue;

      const ranges: [number, number][] = [];
      let searchFrom = 0;
      for (;;) {
        const start = src.indexOf(openTag, searchFrom);
        if (start === -1) break;
        const close = src.indexOf(closeTag, start + openTag.length);
        expect(close, `${name}/${file.rel}: ${openTag} without a matching ${closeTag}`).toBeGreaterThan(-1);
        ranges.push([start, close + closeTag.length]);
        searchFrom = close + closeTag.length;
      }

      const langRe = /project\.language/g;
      let m: RegExpExecArray | null;
      while ((m = langRe.exec(src))) {
        const idx = m.index;
        const inside = ranges.some(([s, e]) => idx >= s && idx < e);
        expect(
          inside,
          `${name}/${file.rel}: 'project.language' at offset ${idx} is outside any ${openTag}…${closeTag} block`,
        ).toBe(true);
      }
    }
  }
});

test("no structured sentinel line interpolates {{ project.language }}", async () => {
  // Sentinel lines (STATUS:, VERDICT:, NEXT_STATUS:, ...) are parsed line-by-line by the
  // calling agent; free text that can contain colons or newlines must never land in one.
  const sentinelLine = /^[A-Z][A-Z_]*:/;
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files) {
      for (const line of file.source.split("\n")) {
        const trimmed = line.trim();
        if (!sentinelLine.test(trimmed)) continue;
        expect(
          trimmed.includes("{{ project.language }}"),
          `${name}/${file.rel}: sentinel line interpolates project.language: ${trimmed}`,
        ).toBe(false);
      }
    }
  }
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
