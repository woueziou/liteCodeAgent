import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/** Ticket 0040: planner proposes an epic, orchestrator relays it, tracker passes --epic. */
async function source(rel: string): Promise<string> {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    const f = pack.files.find((x) => x.rel === rel);
    if (f) return f.source;
  }
  throw new Error(`no pack file ${rel}`);
}

function fencedOutputBlock(src: string): string {
  return src.match(/```\n([\s\S]*?)```/)![1]!;
}

test("planner's output contract carries an EPIC line", async () => {
  const planner = await source("agents/planner.md");
  expect(fencedOutputBlock(planner)).toMatch(/^EPIC:/m);
  expect(planner).toMatch(/attach to an existing relevant one/);
});

test("orchestrator relays EPIC in its output contract", async () => {
  const orchestrator = await source("agents/orchestrator.md");
  expect(fencedOutputBlock(orchestrator)).toMatch(/^EPIC:/m);
});

test("tracker passes --epic and does not treat sentinels as epic names", async () => {
  const tracker = await source("agents/tracker.md");
  expect(tracker).toMatch(/--epic "<name>"/);
  expect(tracker).toMatch(/`none`, `none \(trivial, no planner step\)` or `none \(panel degraded\)`/);
});

test("idea-to-planned hands EPIC to tracker verbatim", async () => {
  expect(await source("skills/idea-to-planned/SKILL.md")).toMatch(/`EPIC:` output verbatim/);
});
