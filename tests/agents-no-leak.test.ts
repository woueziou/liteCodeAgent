import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Ticket 0048: a sub-agent delegated by `implementer` (a review pass, or a subagent-driven
 * implementation step) starts in the invoking session's primary checkout, not the ticket's
 * worktree. Twice already (tickets 0032, 0045) that produced an uncommitted copy of a
 * branch's files in the primary checkout — the second broke `verify-report` for a ticket
 * working in parallel. `implementer`'s prompt must pass the absolute worktree path with an
 * explicit prohibition on writing anywhere else, and must check for and clean up a leak
 * before reporting.
 */
async function implementerSource(): Promise<string> {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    const file = pack.files.find((f) => f.rel === "agents/implementer.md");
    // Ticket 0061: rare-case rules moved into implementer-* reference files; the rules are the union.
    if (file) return [file, ...pack.files.filter((f) => /^reference\/implementer-/.test(f.rel))].map((f) => f.source).join("\n");
  }
  throw new Error("agents/implementer.md not found in any pack");
}

test("implementer tells reviewer/bug-hunter not to write anywhere but the worktree path", async () => {
  const source = await implementerSource();
  expect(source).toMatch(/may (not )?write, edit, or otherwise modify any file tracked by git anywhere else/);
  expect(source).toMatch(/never in the primary checkout/);
});

test("implementer tells subagent-driven implementation steps the same restriction", async () => {
  const source = await implementerSource();
  expect(source).toMatch(/it must not write, edit, or otherwise touch any file outside that worktree path/);
});

test("implementer checks the primary checkout for a leak and cleans up byte-identical matches before reporting", async () => {
  const source = await implementerSource();
  expect(source).toMatch(/git status --short --untracked-files=all/);
  expect(source).toMatch(/0032 and 0045/);
  // The comparison must be working-tree vs. the branch's committed content, not the primary
  // checkout's own HEAD vs. the branch (which almost always differ for a tracked file the
  // branch touched, since HEAD there is still main's old version) — a prior draft of this
  // instruction got that backwards and would never actually detect a leak.
  expect(source).toMatch(/cmp <primary-checkout>\/<path> <\(git -C <worktree> show HEAD:<path>\)/);
});
