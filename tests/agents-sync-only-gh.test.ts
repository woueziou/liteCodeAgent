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
 * that lists `github-project-sync` in its `skills` also has that skill's prose injected
 * into its own context (see this test's own prior finding: the skill's "Moving an item
 * between statuses" section used to instruct a direct `item-edit`, which every agent
 * loading the skill would then follow regardless of what its own prompt said). Skill files
 * legitimately need to *document* the real `gh project item-add`/`item-edit` commands
 * somewhere — that's what `sync`'s own implementation actually runs — so this doesn't ban
 * the substrings outright the way the agent-prompt scan does; it only requires any skill
 * mentioning them to explicitly scope that mention to `sync`, via `SKILL_ITEM_MUTATION_ALLOWED`.
 * Anything not on that list is a skill an agent other than `sync` could read as license to
 * call the GitHub Project directly.
 *
 * Note: `sync`'s own implementation no longer runs those commands either (see the note
 * above the agent-prompt test) — `github-project-sync/SKILL.md` documenting them is stale
 * now that the board is gone. Purging that skill doc is out of this test's scope (it
 * belongs to the same follow-up that clears the leftover `board init`/`board doctor`
 * references from `sync.md`/`dispatcher.md`), so this test still tolerates the skill doc
 * mentioning them for now — it only guards that no *other* skill picks up the same stale
 * pattern in the meantime.
 */
const SKILL_ITEM_MUTATION_ALLOWED = ["github-project-sync"];

test("only the github-project-sync skill's reference doc mentions a gh project item-add/item-edit mutation", async () => {
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
