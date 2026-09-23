---
schemaVersion: 2
id: 0006-feat-agents-stage-implementer-and-reviewer-comme
title: feat(agents): stage implementer and reviewer comments in the local ticket buffer
label: feature
status: done
priority: high
size: small
assignedAgent: implementer
dueDate: 
---

The local ticket buffer becomes the pipeline's source of truth. `implementer` reads tickets locally; on pickup it writes the status transition into the local file, then `sync` informs the board; on completion it updates the file again and `sync` takes over. Comments are staged locally then synced. `reviewer` uses the same path, including the reviewer→implementer rework round trip. Goal: genuinely reduce GitHub API calls.

## Contexte

Existing machinery in `src/tickets/spec.ts` and `src/tickets/sync.ts` already provides:
- `commentBlock` helper for staging comments
- `Ticket.pendingComments` array
- `<!-- litecode:comment -->` markers
- `applyTicketSync` at line 180 already posts staged comments (lines 246-252 document the crash-resumability invariant: comments are dropped after EACH post, failure on comment N+1 must not repost 1..N on re-run).

This ticket wires existing, already-tested machinery to the agents rather than adding new machinery.

## Decisions

This ticket depends on and implements no new architectural decisions. It provides the final piece of the existing infrastructure already in place.

## Plan

- [ ] `src/agents/implementer.ts` — replace `gh issue comment` calls with staged comment wiring via `commentBlock`
- [ ] `src/agents/reviewer.ts` — replace `gh issue comment` calls with staged comment wiring via `commentBlock`
- [ ] Test: verify staged comments are formatted with `<!-- litecode:comment -->` markers and match existing expected format
- [ ] Verify the crash-resumability test in `src/tickets/sync.ts` (lines 246-252 invariant) still passes

## Dependencies

None — this is independently shippable and reduces `gh` calls immediately by wiring existing infrastructure.

---
generated_by: tracker
task: stage implementer and reviewer comments in the local ticket buffer
