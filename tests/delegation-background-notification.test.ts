import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0051: `src/delegation.ts`'s `default` (same-turn) wording is wrong for claude-code's
 * actual `Agent` tool, which can start a sub-agent in the background and deliver its result as
 * a later completion notification instead. implementer.md and chained-implementation's SKILL.md
 * must not tell an agent that a later notification for its own delegation is a bug.
 */
async function coreSource(rel: string) {
  const pack = await loadPack(PACKS, "core");
  const file = pack.files.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not found in core pack`);
  return file.source;
}

test("implementer.md no longer treats a delegation notification as a sign of a bug", async () => {
  const source = await coreSource("agents/implementer.md");
  expect(source).not.toMatch(/that's a bug in how you executed step 8/);
  expect(source).not.toMatch(/an external async event it is not/);
});

test("implementer.md's step 8 and hard rules both say to send exactly one final report", async () => {
  const source = await coreSource("agents/implementer.md");
  const occurrences = source.match(/send exactly one final report/gi) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(2);
});

test("chained-implementation's SKILL.md tells the caller what to do when implementer never sends a final report", async () => {
  const source = await coreSource("skills/chained-implementation/SKILL.md");
  expect(source).toMatch(/no final report/);
  expect(source).toMatch(/check yourself/);
  expect(source).toMatch(/PR/);
  expect(source).toMatch(/ticket file/);
});
