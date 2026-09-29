import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0036: reviewer must check the diff against each acceptance criterion in the
 * ticket's `## Critères d'acceptation` section (ticket 0035's body contract,
 * `CONTRACT_SECTIONS` in src/tickets/spec.ts), not just against the plan — and must say
 * so explicitly, rather than invent criteria, when a ticket has no such section (missing
 * entirely) or a broken one (present but empty).
 */
async function reviewerSource() {
  const core = await loadPack(PACKS, "core");
  const reviewer = core.files.find((f) => f.rel === "agents/reviewer.md");
  if (!reviewer) throw new Error("agents/reviewer.md not found in core pack");
  // Ticket 0064: rare cases moved into reviewer-* skills; the contract is the agent plus those skills.
  const skills = core.files.filter((f) => /^skills\/reviewer-[a-z-]+\/SKILL\.md$/.test(f.rel)).map((f) => f.source);
  return [reviewer.source, ...skills].join("\n");
}

test("reviewer checks each acceptance criterion with proof, using the full status enum", async () => {
  const source = await reviewerSource();
  expect(source).toContain("Critères d'acceptation");
  // Asserted as the exact enum line (not a bare /missing/, which main already contained
  // pre-ticket-0036 — bug-hunter's finding on PR #81): a revert of this feature must fail
  // this test, not just happen to still contain the word "missing" somewhere else.
  expect(source).toMatch(/`satisfied` \/ `partial` \/ `missing` \/ `contradictory`/);
  expect(source).toMatch(/proof/i);
});

test("any non-satisfied criterion (partial, missing, or contradictory) caps the verdict at changes-requested", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(
    /other than `satisfied` — `partial`, `missing`, or `contradictory` — caps `VERDICT` at `changes-requested`/,
  );
});

test("a ticket with no acceptance-criteria section is handled explicitly, never invented", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/no `## Critères d'acceptation` section on this ticket/);
  expect(source).toMatch(/[Nn]ever invent criteria/);
});

test("a present-but-empty acceptance-criteria section is a distinct, flagged case", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/present but empty/);
  expect(source).toMatch(/broken ticket contract/);
});

test("reviewer requires the ticket path and refuses to guess it", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/no ticket path given/);
  expect(source).toMatch(/don't guess a path from the branch name/);
});

test("implementer's step 8 hands reviewer the ticket file's path", async () => {
  const core = await loadPack(PACKS, "core");
  const implementer = core.files.find((f) => f.rel === "agents/implementer.md");
  if (!implementer) throw new Error("agents/implementer.md not found in core pack");
  expect(implementer.source).toMatch(/\*\*the ticket file's path\*\*/);
});

test("not-requested additions are flagged", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/not-requested/);
});

test("the Output contract carries an ACCEPTANCE field with the full status enum", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/^ACCEPTANCE: <one line per criterion.*satisfied\|partial\|missing\|contradictory/m);
});

test("ACCEPTANCE's status words stay in English even under a project language", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/Same rule for `ACCEPTANCE:`/);
});
