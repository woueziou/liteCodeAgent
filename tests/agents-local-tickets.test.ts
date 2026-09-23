import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * ADR 0015: tickets are local files, not GitHub issues. The one GitHub artefact of the
 * pipeline is the pull request (`gh pr create`/`comment`/`view`). A pack prompt that
 * reintroduces an issue call, the removed `sync` command, or the v1 ticket vocabulary
 * would send an agent after something that no longer exists.
 */
const FORBIDDEN: Record<string, RegExp> = {
  "a `gh issue` call": /gh issue\b/,
  "`litecode ticket sync`": /ticket sync\b/,
  "a staged-comment block": /litecode:comment/,
  "the v1 `synced` flag": /\bsynced\b/,
  "an `issue:` frontmatter lookup": /issue: <n>/,
  "closing an issue from a PR": /Closes #/,
};

test("no pack file points an agent at GitHub issues or the removed sync machinery", async () => {
  const violations: string[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files) {
      for (const [label, pattern] of Object.entries(FORBIDDEN)) {
        if (pattern.test(file.source)) violations.push(`${name}/${file.rel} mentions ${label}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

test("there is no sync agent any more", async () => {
  const core = await loadPack(PACKS, "core");
  expect(core.files.map((f) => f.rel)).not.toContain("agents/sync.md");
});
