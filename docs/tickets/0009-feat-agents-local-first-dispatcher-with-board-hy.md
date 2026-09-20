---
schemaVersion: 1
id: 0009-feat-agents-local-first-dispatcher-with-board-hy
title: feat(agents): local-first dispatcher with board hydration, and enforce the sync-only-gh invariant
label: feature
status: backlog
priority: medium
size: large
assignedAgent: human
dueDate: 
issue: 27
synced: true
syncedAt: 2026-09-18T17:28:52.377Z
---

The local ticket buffer becomes the pipeline's source of truth. `implementer` reads tickets locally; on pickup it writes the status transition into the local file, then `sync` informs the board; on completion it updates the file again and `sync` takes over. Comments are staged locally then synced. `reviewer` uses the same path, including the reviewer→implementer rework round trip. Goal: genuinely reduce GitHub API calls. This work also enforces the "only `sync` talks to gh" invariant at runtime — removing direct gh/Bash board access from all agents.

## Contexte

Live evidence of incomplete board state: issues #18 and #19 exist on the board but may have no local file; #16 has NULL status/priority/size fields. If dispatcher ranks without hydration, it has a partial view, strictly worse than today.

Agent tool restrictions (documented in `agent-attribution` skill) are not a reliable enforcement boundary — an agent without Edit/Write still modified a file. So "remove Bash" is necessary but insufficient — the invariant must be checked at test/lint time or with a runtime guard.

Current state:
- `dispatcher` reads local buffer (decision 2 makes this local-first)
- Agents currently call `gh` directly (decision 4 removes this)
- No hydration/reconciliation of board state into local buffer

## Decisions

**Decision 2:** Dispatcher becomes local-first too, in this body of work.

**Decision 4:** The "only `sync` talks to gh" invariant is made REAL: remove direct gh/Bash board access from dispatcher, implementer, reviewer. Specify how the invariant is actually checked (test, lint, or runtime guard).

## Plan

### Dispatcher hydration and local-first ranking
- [ ] `src/agents/dispatcher.ts` — add a `hydrate()` function that materialises a local ticket file for EVERY board item (by querying the board once at startup)
- [ ] `src/agents/dispatcher.ts` — update ranking to read from local buffer instead of querying the board
- [ ] `src/agents/dispatcher.ts` — document what dispatcher does when hydration is incomplete or stale (e.g. "re-hydrate at most once per run; if a board item has no local file after hydration, skip it with a warning")
- [ ] Test: verify dispatcher skips issues with NULL status (today these are invisible; now they are logged as skipped)

### Enforce the sync-only-gh invariant
- [ ] Remove `gh issue comment` from `src/agents/implementer.ts` (covered by Ticket 0006)
- [ ] Remove `gh issue comment` from `src/agents/reviewer.ts` (covered by Ticket 0006)
- [ ] Remove any `gh project item-edit` calls from `src/agents/dispatcher.ts` (verify dispatcher only calls hydrate, no direct board mutations)
- [ ] Add a lint rule or test (`src/__tests__/invariant-sync-only-gh.test.ts` or similar) that scans agent source files and rejects imports of `@octokit/graphql` or Bash spawn of `gh` (except in `sync.ts` itself and documented entry points)
- [ ] Or add a runtime guard: if an agent calls `gh` directly, catch the error and fail loudly ("BUG: agent X should not call gh directly; this must go through sync")

## Dependencies

Depends on Ticket 0008 (file→board status inversion and synced-as-lock ensure dispatcher doesn't pick up an in-flight ticket).

Depends on Ticket 0006 (staged comments so agents don't need `gh issue comment`).

---
generated_by: tracker
task: feat(agents): local-first dispatcher with board hydration, and enforce the sync-only-gh invariant

<!-- litecode:comment -->
**Draft ADR awaiting approval — not committed yet.** Branch
`feat/local-first-dispatcher-sync-only-gh/issue-27` already has the reperimetered, uncontested
part of this ticket committed locally (dispatcher local-first ranking, board hydration for
items with no local file, and a regression test enforcing the sync-only-gh allowlist over
`packs/core/agents/*.md`) — see that commit's message for the reperimeter rationale (no
`src/agents/*.ts` exists in this repo; agents are markdown prompts under `packs/core/agents/`,
and Ticket 0008's file→board lock semantics this ticket depended on were closed not-planned
and never built).

What's held back is the one remaining mechanism decision 2/4 actually need — letting
`dispatcher`/`implementer` push a `Status` transition through `sync` instead of calling
`gh project item-edit` directly — because it conflicts with ADR 0001's explicit "Status is
pull-only past creation" decision, which that ADR itself flags as already made by the
project owner and not to be re-litigated. This ADR proposes a narrow, `Status`-only carve-out
(Priority/Size/Assigned Agent stay pull-only forever) rather than reversing that decision
wholesale. Full text below, verbatim — also at
`docs/decisions/0010-agent-initiated-status-push-through-sync.md` in the worktree (not yet
`git add`ed/committed, per the ADR approval gate).

---

# 0010. Agent-initiated Status push through `sync`

Status: proposed
Date: 2026-09-20

## Context

Issue #27 asks for two things:

- **Decision 2:** `dispatcher` becomes local-first — it ranks the Backlog from the local
  ticket buffer instead of querying the board directly.
- **Decision 4:** the "only `sync` talks to `gh`" invariant becomes real — direct
  `gh`/board access is removed from `dispatcher`, `implementer`, and `reviewer`, and the
  invariant is checked by test/lint or a runtime guard rather than trusted by convention.

This PR (branch `feat/local-first-dispatcher-sync-only-gh/issue-27`) already ships the
part of decision 2/4 that doesn't require a new decision: `dispatcher` now ranks from the
local buffer, a hydration pass materialises a local file for any board item that has none
(`planTicketHydration`/`applyTicketHydration` in `src/tickets/sync.ts`, wired into
`litecode ticket sync`), and a new test (`tests/agents-sync-only-gh.test.ts`) scans every
agent prompt in `packs/core/agents/*.md` for `gh issue create`/`gh issue comment`/
`gh project item-add`/`gh project item-edit` and fails if one appears outside a named,
documented allowlist.

What that PR does **not** do: remove `dispatcher`'s (and, unaddressed so far,
`implementer`'s) direct `gh project item-edit` call for moving a board item's `Status`
field — Backlog → Planned for `dispatcher`, Planned → In Progress → Review/Ready to Merge
for `implementer`. That is the one mechanism issue #27 actually needs to complete decision
4, and it cannot be built without first resolving a conflict with an existing decision.

## The conflict

ADR 0001 records, under "Decisions already made by the project owner (recorded here, not
re-litigated)":

> Status/Priority/Size are pushed to the board exactly once, at ticket creation... After
> creation, those three fields are **pull-only**: `litecode ticket sync`'s pull step reads
> them from the board into the file; the push step never sends them again.

Issue #27's own body describes the intended flow: "`implementer` reads tickets locally; on
pickup it writes the status transition into the local file, then `sync` informs the
board... at the end it updates the file again and `sync` takes over." That flow requires
`sync`'s push step to push `Status` on an already-created ticket — exactly what ADR 0001
says never happens. The two cannot both be true as written.

This is not a corner case that slipped through: ADR 0001 explicitly flags that Status
pull-only-past-creation line as *already decided by the project owner*, not something
`planner`/`implementer` chose and could freely amend. Reversing or narrowing it needs the
same kind of explicit approval, not a unilateral code change buried inside a "local-first
dispatcher" ticket.

## What's actually being proposed

Not a wholesale reversal of ADR 0001. A narrow, additive carve-out, scoped to `Status`
only:

1. **`Status` becomes push-on-update, but only when the local file is the thing that
   changed it.** `planTicketPull` already skips any ticket that is dirty
   (`!ticket.synced || ticket.pendingComments.length > 0`) — it never overwrites a dirty
   file's fields, by design (see `planTicketPull`'s doc comment). So if `dispatcher`
   writes `ticket.status = "planned"` and marks the file dirty (`synced: false`), the next
   `sync` run's pull step already leaves that value alone. The missing piece is purely on
   the push side: `planTicketSync`'s `update` branch (`src/tickets/sync.ts`, currently
   "title/body/comments only") would gain a `Status` `FieldEdit` when the ticket's local
   `status` differs from what pull just read off the board for that same run.
2. **`Priority`, `Size`, and `Assigned Agent` stay exactly as ADR 0001 left them:
   pull-only, forever.** Those are human-curated fields a pipeline agent has no business
   overwriting. `Status` is different in kind — it's the one field whose transitions are
   *driven by the pipeline itself* (`dispatcher`/`implementer`/`reviewer`'s own hand-offs
   between `Planned`/`In Progress`/`Review`/`Ready to Merge`/`Blocked`), not something a
   human sets once and expects to persist untouched.
3. **Accepted risk, stated plainly:** if a human moves the card on the board *and* an
   agent independently marks the same ticket dirty with a different `Status` in the same
   narrow window before the next `sync` run, the agent's local write wins — the human's
   board move is silently overwritten. This is the same class of risk `push` already
   accepts today for title/body (an agent's local edit unconditionally overwrites
   whatever's on the board for those two fields, already, with no reconciliation), just
   newly extended to `Status`. Worth naming, not worth blocking on: the window is one
   `sync` cycle, and a human editing the board's `Status` field concurrently with the
   pipeline moving the same ticket is already an edge case the current design doesn't
   handle for title/body either.

If approved, the follow-up work (a separate PR, not folded into this one) is:
`planTicketSync`'s `update` action gains a `Status` `FieldEdit` when local `status` !=
board `Status` after pull; `dispatcher.md`/`implementer.md` are updated to write the local
`status` field (`dispatcher` needs `Write`/`Edit` added to its tool list to do this — it
currently only has `Bash, Read`) instead of calling `gh project item-edit` directly;
`tests/agents-sync-only-gh.test.ts`'s `ITEM_EDIT_ALLOWED` list drops `dispatcher.md`/
`implementer.md` once they no longer need the exception (they aren't on it today — see the
test's own doc comment for why `item-edit` isn't fully enforced yet).

## Decision this ADR asks the project owner to make

Approve (or reject, or amend) the narrow `Status`-only carve-out above: `Status` becomes
push-on-update through `sync`, sourced from a dirty local file, while `Priority`/`Size`/
`Assigned Agent` remain pull-only exactly as ADR 0001 already decided. Nothing else in
ADR 0001 is affected by this ADR.
<!-- /litecode:comment -->
