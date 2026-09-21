---
schemaVersion: 1
id: 0008-feat-tickets-invert-status-flow-to-file-board-wi
title: feat(tickets): invert status flow to file→board with detect-and-block and synced-as-lock
label: feature
status: done
priority: high
size: large
assignedAgent: human
dueDate: 
issue: 26
synced: true
syncedAt: 2026-09-18T17:28:42.079Z
---

The local ticket buffer becomes the pipeline's source of truth. `implementer` reads tickets locally; on pickup it writes the status transition into the local file, then `sync` informs the board; on completion it updates the file again and `sync` takes over. Comments are staged locally then synced. `reviewer` uses the same path, including the reviewer→implementer rework round trip. Goal: genuinely reduce GitHub API calls. This REVERSES a documented decision: `src/tickets/spec.ts` documents `status` as board→file only. ADR `docs/decisions/0001-local-ticket-buffer-and-github-sync.md` must be explicitly superseded.

## Contexte

Current state:
- `CURRENT_SCHEMA_VERSION = 1` in `src/tickets/spec.ts`; the schema treats missing `schemaVersion` as current version, so no real migration path exists yet.
- `status` is documented as board→file only ("once `issue`/`synced` show the ticket has a board item, this field is overwritten by `ticket sync`'s pull step, never read for a push").
- Live evidence of silent partial failure: issue #16 was created by `sync` but landed with Status/Priority/Size all NULL, invisible to dispatcher ranking, with no logging, retrying, or reconciliation.
- `sync.ts:87` documents: `const dirty = !ticket.synced || ticket.pendingComments.length > 0;`
- Comments are dropped after EACH post (lines 246-252) to ensure a failure on comment N+1 doesn't repost 1..N on re-run.

The new direction inverts the status flow: file→board (with board-as-cache), detects conflicts when both disagree, and uses `synced: false` as an in-flight lock to prevent concurrent access during a mutation.

## Decisions

**Decision 1:** Conflict policy: detect-and-block — when local file and board disagree on status, `sync` refuses and reports rather than picking a winner.

**Decision 3:** Reviewer verdict and rework round trip are STRUCTURED frontmatter fields, not free-form comment blocks. This triggers the project's first real schemaVersion migration.

**Decision 5:** Sequencing: `synced: false` acts as a LOCK — a ticket with unsynced local changes is "in flight" and no other agent may pick it up. A crash leaves it locked until a reconciliation command clears it.

**Decision 7:** Migration: loading a ticket that lacks the new fields must ACCEPT the absence and distinguish "never reviewed" from a real verdict (absent field ≠ `verdict: none`). The migration is written on the ticket's next write. Requires a test fixture of a real pre-schemaVersion ticket file.

## Plan

### Schema and migration (src/tickets/spec.ts)
- [ ] Bump `CURRENT_SCHEMA_VERSION` to 2
- [ ] Add optional frontmatter fields: `reviewerVerdict?: "approve" | "approve-with-notes" | "changes-requested" | "decline"` and `reworkRound?: { from: "reviewer"; round: number; feedback: string }[]` (structured, not free-form)
- [ ] Document that missing fields in a loaded ticket (pre-migration) are distinct from explicit `verdict: null` — preserve the absence
- [ ] Write migrations on next persist: if loading a ticket with schemaVersion < 2, preserve missing fields and bump schemaVersion on write (do not re-write all fields)
- [ ] Add a test fixture: `src/tickets/__fixtures__/pre-schema-2-ticket.md` with no schemaVersion or reviewer fields, verify loader accepts it and migration writes it correctly

### Status inversion (src/tickets/spec.ts and sync.ts)
- [ ] Rewrite `status` documentation: "file→board; after sync, board values are mirrored back to the file as a cache. If local and board disagree, `sync` will block and report the conflict."
- [ ] Add runtime enforcement: when loading a board item, compare its status against local file and flag if they differ
- [ ] Implement detect-and-block: if local status and board status differ, `applyTicketSync` returns outcome `"blocked"` with detail `"status conflict: local='X' board='Y'"` instead of pushing

### In-flight lock (src/tickets/spec.ts and sync.ts)
- [ ] Document `synced` as a lock: "while `synced: false`, this ticket is in flight and no other agent should attempt to pick it up"
- [ ] Add a `reconcile` command to `src/cli.ts` (or as a litecode subcommand) that can clear a `synced: false` lock left by a crash, with explicit prompting ("clear lock on ticket #N?")
- [ ] Preserve the per-mutation persist/resumability invariant (sync.ts:246-252): when a status transition is applied, persist it immediately; if sync fails on comment N+1, a re-run must not repost comments 1..N

### ADR supersession
- [ ] Create `docs/decisions/0004-file-first-status-and-conflict-detection.md` (supersedes ADR 0001)
- [ ] Document the new failure mode (local transition no agent observed) vs. today's (resumable half-pushed write)
- [ ] Explain why conflict detection is necessary (issue #16 example) and why the lock prevents double-pickup on crash

## Dependencies

Depends on Ticket 0007 (typed `applyTicketSync` result) so `PerTicketResult` can express the `"blocked"` outcome.

Ticket 0009 depends on this ticket. Ticket 0006 does NOT — it is independently shippable.

---
generated_by: tracker
task: feat(tickets): invert status flow to file→board with detect-and-block and synced-as-lock
