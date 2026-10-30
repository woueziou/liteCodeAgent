import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0045: on PR #81 (ticket 0036), `reviewer` compared the base and branch with a
 * two-dot diff and mistook a ticket-status commit landed on the base (per PR #77, agents
 * commit ticket changes straight to the base while a PR is open) for something the PR itself
 * reverted. `reviewer` and `bug-hunter` must be told to use a three-dot diff from the
 * merge-base, and that base commits postdating the merge-base are not part of the PR.
 */
async function packFiles() {
  const files: { name: string; rel: string; source: string }[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const f of pack.files) files.push({ name, rel: f.rel, source: f.source });
  }
  return files;
}

test("reviewer is told to diff with three dots, from the merge-base", async () => {
  const reviewer = (await packFiles()).find((f) => f.rel === "agents/reviewer.md")!;
  expect(reviewer.source).toMatch(/<base>\.\.\.<branch>/);
  expect(reviewer.source).toMatch(/never `git diff <base> <branch>`\/`<base>\.\.<branch>`/);
});

test("bug-hunter is told to diff with three dots, from the merge-base", async () => {
  const bugHunter = (await packFiles()).find((f) => f.rel === "agents/bug-hunter.md")!;
  expect(bugHunter.source).toMatch(/<base>\.\.\.<branch>/);
  expect(bugHunter.source).toMatch(/never `git diff <base> <branch>`\/`<base>\.\.<branch>`/);
});

test("reviewer and bug-hunter both know post-merge-base ticket commits on the base aren't part of the PR", async () => {
  const files = await packFiles();
  const reviewer = files.find((f) => f.rel === "agents/reviewer.md")!;
  const bugHunter = files.find((f) => f.rel === "agents/bug-hunter.md")!;
  for (const f of [reviewer, bugHunter]) {
    expect(f.source).toMatch(/commit ticket-status changes straight to the base/);
    expect(f.source).toMatch(/not part of the PR/);
  }
});

test("implementer requires re-running reviewer with evidence before Ready to Merge on a suspected false positive", async () => {
  // Step 10 lives in implementer-inline-tail (ADR 0027), rendered in place when the handoff is off.
  const implementer = (await packFiles()).find((f) => f.rel === "reference/implementer-inline-tail.md")!;
  expect(implementer.source).toMatch(/false positive/);
  expect(implementer.source).toMatch(/re-invoke `reviewer` with your evidence/);
});
