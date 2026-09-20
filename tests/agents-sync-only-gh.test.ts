import { expect, test } from "bun:test";
import { join } from "node:path";
import { listPacks, loadPack } from "../src/packs.ts";

const PACKS = join(import.meta.dir, "..", "packs");

/**
 * Enforces (part of) the "only `sync` talks to gh" invariant from issue #27: agent tool
 * restrictions declared in frontmatter are not a reliable enforcement boundary on their
 * own (see the `agent-attribution` skill and issue #27's Context section — an agent
 * without Edit/Write still modified a file once), so the invariant needs a check that
 * doesn't depend on an agent's own self-restraint. This mirrors `tests/packs.test.ts`'s
 * "no pack file hardcodes a project literal" test: a plain substring scan over every
 * agent prompt, with an explicit, named allowlist for the handful of documented
 * exceptions — anything not on that list is a regression, not a judgment call.
 *
 * This only covers the gh calls that mutate GitHub *board/issue state* directly
 * (issue creation, issue comments, project item add/edit) — not every `gh` invocation.
 * `gh issue view` (read-only) and `gh pr create`/`gh pr comment` (opening/commenting on a
 * pull request, not a board mutation) are out of scope; `implementer` legitimately does
 * both as part of implementing a ticket.
 *
 * `gh project item-edit` for the Status field specifically is NOT yet enforced here:
 * `dispatcher`/`implementer` moving a board item's Status still goes through a direct
 * `item-edit` today, because making that push-only-through-`sync` requires extending
 * `litecode ticket sync`'s push step to cover Status past creation — which conflicts with
 * ADR 0001's explicit "Status/Priority/Size are pull-only past creation" decision, marked
 * there as already decided by the project owner and not to be re-litigated casually. That
 * extension is proposed in ADR 0010, pending approval; once it lands, `dispatcher.md` and
 * `implementer.md` should be removed from `ITEM_EDIT_ALLOWED` below and this comment
 * updated.
 */

type Forbidden = { pattern: RegExp; allow: string[] };

const ISSUE_CREATE_ALLOWED = ["sync.md", "tracker.md"];
const ISSUE_COMMENT_ALLOWED = ["sync.md", "implementer.md", "reviewer.md", "triage.md"];
const ITEM_ADD_ALLOWED = ["sync.md", "tracker.md"];
const ITEM_EDIT_ALLOWED = ["sync.md", "reviewer.md", "tracker.md"]; // see module doc comment re: ADR 0010

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

test("sync.md is the only agent whose description says it talks to gh on a ticket's behalf", async () => {
  for (const name of await listPacks(PACKS)) {
    const pack = await loadPack(PACKS, name);
    for (const file of pack.files.filter((f) => f.rel.startsWith("agents/") && f.rel !== "agents/sync.md")) {
      expect(file.source, file.rel).not.toMatch(/is the only agent in the pack that talks to `gh`/);
    }
  }
});
