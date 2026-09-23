---
schemaVersion: 2
id: 0009-feat-agents-local-first-dispatcher-with-board-hy
title: feat(agents): local-first dispatcher with board hydration, and enforce the sync-only-gh invariant
label: feature
status: done
priority: medium
size: large
assignedAgent: implementer
dueDate: 
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
