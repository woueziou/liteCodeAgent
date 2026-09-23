---
schemaVersion: 2
id: 0022-refactor-tickets-reloger-le-vocabulaire-statut-p
title: refactor(tickets): reloger le vocabulaire statut/priorité/taille hors de src/board/spec.ts
label: chore
status: done
priority: high
size: small
assignedAgent: human
dueDate: 
---

Move status/priority/size vocabulary out of the board module — it is a compile-time dependency that makes the ticket schema brittle. `src/tickets/spec.ts:28` imports `STATUS_ROLES`, `PRIORITY_OPTIONS`, `SIZE_OPTIONS` from `../board/spec.ts`. This is a compilation dependency, not just a runtime one: removing `src/board/` would break the ticket schema.

Relocate `STATUS_ROLES`, `StatusRole`, `PRIORITY_OPTIONS`, `SIZE_OPTIONS` to `src/tickets/spec.ts` (or a new `src/tickets/status.ts` if `spec.ts` becomes too large).

**Do not relocate**: `FIELD_SPECS`, `REQUIRED_LABELS`, and `BoardData` — these are board-specific (the shape of GitHub Project fields) and will be **deleted** in lot 6, not moved.

Epic: local-first-tickets
Lot: 2/9

PR opened: https://github.com/woueziou/liteCodeAgent/pull/51 (branch `refactor/relocate-status-vocab/issue-0022`).

reviewer verdict: **changes-requested** (posted verbatim on the PR). Summary: the actual diff is clean — every check the reviewer could complete passed (tsc, 165/165 tests, scope exactly the 5 files expected, no import cycle, `FIELD_SPECS`/`REQUIRED_LABELS`/`BoardData` correctly left in `board/spec.ts`, the one earlier finding — a stale doc-comment reference to `board/spec.ts` for `PRIORITY_OPTIONS`/`SIZE_OPTIONS` — was fixed in commit 26f33f5 and reviewer confirmed the fix). The verdict is capped at `changes-requested` purely for a procedural reason: reviewer's `code-review` skill sub-pass ran in the background and didn't return within its turn, and its toolset had no `Monitor` tool to wait on it, so reviewer refused to report a completed correctness pass it hadn't actually gotten back. There is no code defect identified.

REENTRY guidance from reviewer: either (a) re-run review in a session where the background `code-review` pass can actually be waited on to completion, or (b) a human explicitly accepts the manual verification already done as sufficient for this low-risk mechanical relocation and waives the automated pass. Not a ticket-worthy defect — leaving this in `Review` for a human call rather than moving to Ready to Merge.
