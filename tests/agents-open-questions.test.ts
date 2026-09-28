import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0043: `ticket move ... planned` refuses a ticket carrying the `[À CLARIFIER]`
 * marker (ticket 0035), but before this ticket no agent ever emitted it — the block
 * existed with nothing feeding it. `planner` now surfaces open questions explicitly,
 * `orchestrator` relays them verbatim, `tracker` writes them into the ticket body with
 * the marker, and `idea-to-planned` stops before dispatching a ticket that carries one.
 */
async function packFiles() {
  const files: { name: string; rel: string; source: string }[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const f of pack.files) files.push({ name, rel: f.rel, source: f.source });
  }
  return files;
}

test("planner emits an OPEN_QUESTIONS line instead of silently resolving open points", async () => {
  const planner = (await packFiles()).find((f) => f.rel === "agents/planner.md")!;
  expect(planner.source).toMatch(/OPEN_QUESTIONS:/);
  expect(planner.source).toMatch(/phrased as a question, not an affirmation/);
  expect(planner.source).toMatch(/don't resolve a real one yourself just to avoid raising it/i);
});

test("orchestrator relays planner's OPEN_QUESTIONS verbatim", async () => {
  const orchestrator = (await packFiles()).find((f) => f.rel === "agents/orchestrator.md")!;
  expect(orchestrator.source).toMatch(/OPEN_QUESTIONS:/);
  expect(orchestrator.source).toMatch(/relayed verbatim, unedited and unresolved by you/);
  expect(orchestrator.source).toMatch(/never resolve or drop a `planner`-flagged open question yourself/);
});

test("tracker writes OPEN_QUESTIONS into the ticket body with the [À CLARIFIER] marker", async () => {
  const tracker = (await packFiles()).find((f) => f.rel === "agents/tracker.md")!;
  expect(tracker.source).toMatch(/OPEN_QUESTIONS:/);
  expect(tracker.source).toMatch(/\[À CLARIFIER\]/);
  expect(tracker.source).toMatch(/never paraphrased, never answered/);
});

test("tracker's report says whether the drafted ticket carries the [À CLARIFIER] marker", async () => {
  const tracker = (await packFiles()).find((f) => f.rel === "agents/tracker.md")!;
  expect(tracker.source).toMatch(/whether the body carries a `\[À CLARIFIER\]` marker/);
});

test("idea-to-planned stops before dispatcher when the drafted ticket carries the marker", async () => {
  const skill = (await packFiles()).find((f) => f.rel === "skills/idea-to-planned/SKILL.md")!;
  expect(skill.source).toMatch(/do not invoke `dispatcher`/);
  expect(skill.source).toMatch(/refuses that transition outright while the marker is present/);
  expect(skill.source).toMatch(/only a human or `triage` removing the marker can unblock it/);
});

test("triage remains the marker's removal path back to planned", async () => {
  const triage = (await packFiles()).find((f) => f.rel === "agents/triage.md")!;
  expect(triage.source).toMatch(/\[À CLARIFIER\]/);
  expect(triage.source).toMatch(/ticket move <id> planned/);
});
