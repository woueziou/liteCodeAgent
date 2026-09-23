---
schemaVersion: 2
id: 0021-refactor-gh-reloger-le-wrapper-gh-hors-de-src-bo
title: refactor(gh): reloger le wrapper gh() hors de src/board/
label: chore
status: done
priority: high
size: small
assignedAgent: human
dueDate: 
---

Remove the generic `gh()` CLI wrapper from the board module — it has no business being there. `src/board/gh.ts` contains `gh()`, `ensureAuth`, `onGhRetry`, `RateLimitError`, which are a generic wrapper around the `gh` CLI, not a board-specific module; it is stored there only for convenience.

Move it to `src/gh.ts`. Update the importers:
- `src/cli.ts:9`
- `src/tickets/dedupe.ts:20`
- `src/tickets/sync.ts:26`

No behavioral change; `bun run check` and all 165 tests must remain green.

**Must land first**: `dedupe.ts` depends on `gh()` for deduplication against open issues (protection against incidents #18/#19) and must never be left without access to `gh()`.

Epic: local-first-tickets
Lot: 1/9
