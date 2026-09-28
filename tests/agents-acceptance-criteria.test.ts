import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0036: reviewer must check the diff against each acceptance criterion in the
 * ticket's `## Critères d'acceptation` section (ticket 0035's body contract,
 * `CONTRACT_SECTIONS` in src/tickets/spec.ts), not just against the plan — and must say
 * so explicitly, rather than invent criteria, when a pre-0035 ticket has no such section.
 */
async function reviewerSource() {
  const core = await loadPack(PACKS, "core");
  const reviewer = core.files.find((f) => f.rel === "agents/reviewer.md");
  if (!reviewer) throw new Error("agents/reviewer.md not found in core pack");
  return reviewer.source;
}

test("reviewer checks each acceptance criterion with proof", async () => {
  const source = await reviewerSource();
  expect(source).toContain("Critères d'acceptation");
  expect(source).toMatch(/satisfied/);
  expect(source).toMatch(/partial/);
  expect(source).toMatch(/missing/);
  expect(source).toMatch(/proof/i);
});

test("an unproven criterion caps the verdict at changes-requested", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/unproven criterion caps `VERDICT` at `changes-requested`/);
});

test("a ticket with no acceptance-criteria section is handled explicitly, never invented", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/no `## Critères d'acceptation` section/);
  expect(source).toMatch(/[Nn]ever invent criteria/);
});

test("not-requested additions are flagged", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/not-requested/);
});

test("the Output contract carries an ACCEPTANCE field", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/^ACCEPTANCE: /m);
});
