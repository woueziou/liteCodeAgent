import { expect, test } from "bun:test";
import { join } from "node:path";
import { loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0056: `reviewer`'s test-first check and `implementer`'s no-force-push hard rule
 * used to contradict each other the moment a test-first commit was missing on already-
 * pushed history — the only "fix" reviewer could ask for was a history rewrite, which
 * `implementer` was separately forbidden from doing. PRs #95 and #98 got force-pushed
 * anyway; PR #96 stayed stuck in `review` with no way out. These tests pin the fix: the
 * test-first check becomes non-blocking (with independent proof) once history is already
 * pushed, and both agents explicitly refuse a rewrite even if asked for one.
 */
async function reviewerSource() {
  const core = await loadPack(PACKS, "core");
  const reviewer = core.files.find((f) => f.rel === "agents/reviewer.md");
  if (!reviewer) throw new Error("agents/reviewer.md not found in core pack");
  // Ticket 0064: rare cases moved into reviewer-* skills; the contract is the agent plus those skills.
  const skills = core.files.filter((f) => /^skills\/reviewer-[a-z-]+\/SKILL\.md$/.test(f.rel)).map((f) => f.source);
  return [reviewer.source, ...skills].join("\n");
}

async function implementerSource() {
  const core = await loadPack(PACKS, "core");
  const implementer = core.files.find((f) => f.rel === "agents/implementer.md");
  if (!implementer) throw new Error("agents/implementer.md not found in core pack");
  // Ticket 0061: the detailed refusal moved into implementer-review-disputes; the rules are the union.
  return [implementer, ...core.files.filter((f) => /^skills\/implementer-/.test(f.rel))].map((f) => f.source).join("\n");
}

test("reviewer never asks to rewrite, split, or squash already-pushed history over a missing test-first commit", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/never.{0,40}, by itself, grounds to ask `implementer` to rewrite, split, squash/s);
  expect(source).toMatch(/PRs #95 and #98 got a history rewrite and a forced push/);
});

test("reviewer independently verifies a missing test-first commit on pushed history and treats it as non-blocking when it can", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/not satisfied but non-blocking/);
  expect(source).toMatch(/`VERDICT` is left uncapped by this/);
});

test("reviewer's TEST_FIRST output line documents the non-blocking, already-pushed case", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/^TEST_FIRST: <.*non-blocking, already-pushed history/m);
});

test("reviewer never proposes a remedy that requires rewriting or force-pushing pushed history", async () => {
  const source = await reviewerSource();
  expect(source).toMatch(/\*\*Never\*\* propose a remedy that requires rewriting, squashing, or force-pushing history already pushed/);
});

test("implementer treats the test-first commit as a blocking checkpoint before its first push", async () => {
  const source = await implementerSource();
  expect(source).toMatch(/This is a blocking checkpoint, not a reminder/);
  expect(source).toMatch(/before your first `git push` on this branch/);
});

test("implementer refuses a history rewrite / force-push even when reviewer explicitly asks for one", async () => {
  const source = await implementerSource();
  expect(source).toMatch(/This applies even when `reviewer` explicitly asks for it\./);
  expect(source).toMatch(/do not comply, and do not `git push --force`/);
});

test("both agents cite ticket 0056 as the precedent this fixes", async () => {
  const reviewer = await reviewerSource();
  const implementer = await implementerSource();
  expect(reviewer).toMatch(/ticket 0056/);
  expect(implementer).toMatch(/ticket 0056/);
});
