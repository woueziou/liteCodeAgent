import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Enforces (part of) the "only `sync` talks to gh" invariant: agent tool restrictions
 * declared in frontmatter are not a reliable enforcement boundary on their own (see the
 * `agent-attribution` skill — an agent without Edit/Write still modified a file once), so
 * the invariant needs a check that doesn't depend on an agent's own self-restraint. This
 * mirrors `tests/packs.test.ts`'s "no pack file hardcodes a project literal" test: a plain
 * substring scan over every agent prompt, with an explicit, named allowlist for the
 * handful of documented exceptions — anything not on that list is a regression, not a
 * judgment call.
 *
 * This only covers the gh calls that mutate GitHub *issue* state directly (issue
 * creation, issue comments) — not every `gh` invocation. `gh issue view` (read-only) and
 * `gh pr create`/`gh pr comment` (opening/commenting on a pull request) are out of scope;
 * `implementer` legitimately does both as part of implementing a ticket.
 *
 * `gh project item-add`/`gh project item-edit` no longer name a real capability: the
 * GitHub Project board itself was removed (`src/board/` deleted, no `gh project` call
 * left anywhere in `src/` — `src/tickets/sync.ts` only ever shells out to `gh issue
 * create`/`edit`/`comment` now). So unlike the other two patterns, these two have **no**
 * allowlist at all, `sync.md` included: nothing needs to call them because nothing left
 * for them to mutate. If either literal reappears in any agent prompt, that's a
 * regression to a capability that no longer exists, not a documented exception. The
 * surviving `gh` surface for the whole pipeline is `gh issue`/`gh pr`, routed through the
 * relocated wrapper in `src/gh.ts`, plus the read-only `fetchOpenIssueDedupeCandidates` in
 * `src/tickets/dedupe.ts`.
 */

type Forbidden = { pattern: RegExp; allow: string[] };

const ISSUE_CREATE_ALLOWED = ["sync.md", "tracker.md"];
const ISSUE_COMMENT_ALLOWED = ["sync.md", "implementer.md", "reviewer.md", "triage.md"];
const ITEM_ADD_ALLOWED: string[] = [];
const ITEM_EDIT_ALLOWED: string[] = [];

const FORBIDDEN: Record<string, Forbidden> = {
  "gh issue create": { pattern: /gh issue create/, allow: ISSUE_CREATE_ALLOWED },
  "gh issue comment": { pattern: /gh issue comment/, allow: ISSUE_COMMENT_ALLOWED },
  "gh project item-add": { pattern: /gh project item-add/, allow: ITEM_ADD_ALLOWED },
  "gh project item-edit": { pattern: /gh project item-edit/, allow: ITEM_EDIT_ALLOWED },
};

test("only documented entry points mention a gh board/issue mutation in an agent prompt", async () => {
  const violations: string[] = [];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files.filter((f) => f.rel.startsWith("agents/"))) {
      const basename = file.rel.split("/").pop()!;
      for (const [label, { pattern, allow }] of Object.entries(FORBIDDEN)) {
        if (pattern.test(file.source) && !allow.includes(basename)) {
          violations.push(`${name}/${file.rel} mentions '${label}', which is not on its allowlist`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
});

/**
 * Agent prompts aren't the only place an agent takes its instructions from — every agent
 * that lists a skill in its `skills` also has that skill's prose injected into its own
 * context (see this test's own prior finding: the `github-project-sync` skill's "Moving an
 * item between statuses" section used to instruct a direct `item-edit`, which every agent
 * loading the skill would then follow regardless of what its own prompt said). That skill
 * was removed once the GitHub Project board mechanism it documented (`board init`, `gh
 * project item-add`/`item-edit`, `board.json`) was deleted from the codebase entirely —
 * there is no longer any `gh project` invocation anywhere in this pack. No skill may
 * reintroduce one without updating this allowlist and explaining why the mutation is
 * scoped to `sync`.
 */
const SKILL_ITEM_MUTATION_ALLOWED: string[] = [];

test("no pack skill mentions a gh project item-add/item-edit mutation", async () => {
  const violations: string[] = [];
  const mutationPatterns = [FORBIDDEN["gh project item-add"]!.pattern, FORBIDDEN["gh project item-edit"]!.pattern];
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files.filter((f) => f.rel.startsWith("skills/") && f.rel.endsWith("SKILL.md"))) {
      const skillName = file.rel.split("/")[1]!;
      const mentions = mutationPatterns.some((pattern) => pattern.test(file.source));
      if (mentions && !SKILL_ITEM_MUTATION_ALLOWED.includes(skillName)) {
        violations.push(`${name}/${file.rel} mentions a gh project item mutation, which is not on SKILL_ITEM_MUTATION_ALLOWED`);
      }
    }
  }
  expect(violations).toEqual([]);
});

test("sync.md is the only agent whose description says it talks to gh on a ticket's behalf", async () => {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files.filter((f) => f.rel.startsWith("agents/") && f.rel !== "agents/sync.md")) {
      expect(file.source, file.rel).not.toMatch(/is the only agent in the pack that talks to `gh`/);
    }
  }
});
