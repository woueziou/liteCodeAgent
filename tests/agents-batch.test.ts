import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadPack } from "../src/packs.ts";

/** Ticket 0065: small related tickets can be batched into one branch/PR. */
const PACKS = join(import.meta.dir, "..", "packs");

async function get(rel: string) {
  const pack = await loadPack(PACKS, "core");
  const file = pack.files.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not found`);
  return file.source;
}

test("dispatcher proposes batches: small, same epic, at most 4, no shared files", async () => {
  const src = await get("agents/dispatcher.md");
  expect(src).toMatch(/## Batches/);
  expect(src).toMatch(/`small` tickets of the same epic/);
  expect(src).toMatch(/at most 4 per batch/);
  expect(src).toMatch(/no file named in a ticket's plan appears in another batch/);
  expect(src).toMatch(/BATCHES:/);
});

test("implementer accepts a batch: one branch, one PR citing each ticket, per-ticket status, one review", async () => {
  const body = await get("agents/implementer.md");
  expect(body).toContain("{{> reference implementer-batch}}");
  const ref = await get("reference/implementer-batch.md");
  expect(ref).toMatch(/^---\nname: implementer-batch\n/);
  expect(ref).toMatch(/at most 4/);
  expect(ref).toMatch(/One worktree and one branch/);
  expect(ref).toMatch(/one `Ticket: <NNNN-slug>` line/);
  expect(ref).toMatch(/One review round/);
  expect(ref).toMatch(/one `ACCEPTANCE` block per ticket/);
  expect(ref).toMatch(/Move each ticket on its own/);
});

test("reviewer checks each ticket's criteria in a batch", async () => {
  expect(await get("agents/reviewer.md")).toContain("{{> reference reviewer-batch}}");
  const ref = await get("reference/reviewer-batch.md");
  expect(ref).toMatch(/one `ACCEPTANCE:` block per ticket/);
  expect(ref).toMatch(/Attribute each finding to a ticket id/);
});

test("chained-implementation can launch a batch", async () => {
  const src = await get("skills/chained-implementation/SKILL.md");
  expect(src).toMatch(/## Running a batch/);
  expect(src).toMatch(/more than 4 tickets/);
  expect(src).toContain("implementer-batch");
});
