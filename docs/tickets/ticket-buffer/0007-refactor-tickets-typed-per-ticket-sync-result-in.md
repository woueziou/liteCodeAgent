---
schemaVersion: 1
id: 0007-refactor-tickets-typed-per-ticket-sync-result-in
title: refactor(tickets): typed per-ticket sync result instead of Promise<string[]>
label: chore
status: done
priority: high
size: medium
assignedAgent: implementer
dueDate: 
issue: 25
synced: true
syncedAt: 2026-09-18T17:28:31.647Z
---

The local ticket buffer becomes the pipeline's source of truth. `implementer` reads tickets locally; on pickup it writes the status transition into the local file, then `sync` informs the board; on completion it updates the file again and `sync` takes over. Comments are staged locally then synced. `reviewer` uses the same path, including the reviewer→implementer rework round trip. Goal: genuinely reduce GitHub API calls.

## Contexte

Today `applyTicketSync` (declared at `src/tickets/sync.ts:180`) returns `Promise<string[]>` — a list of log lines. The CLI at `src/cli.ts:605` consumes this and collapses outcomes to an exit code at lines 661-668.

A single exit code cannot represent "3 synced, 1 blocked on conflict, 2 hydrated with no local file, 1 skipped because Status was NULL". The local-first dispatcher (Ticket 0008) needs programmatic access to per-ticket outcomes.

## Decisions

**Decision 6:** `applyTicketSync` returns a TYPED PER-TICKET RESULT (array of `{ticket, outcome: "synced"|"blocked"|"hydrated"|"skipped", detail}`) instead of today's `Promise<string[]>`. Internal contract change; no external consumers after threading through the CLI.

## Plan

- [ ] `src/tickets/sync.ts` — define `type SyncOutcome = "synced" | "blocked" | "hydrated" | "skipped"`
- [ ] `src/tickets/sync.ts` — define `type PerTicketResult = { ticket: Ticket; outcome: SyncOutcome; detail: string }`
- [ ] `src/tickets/sync.ts:180` — change `applyTicketSync` return type from `Promise<string[]>` to `Promise<PerTicketResult[]>`
- [ ] `src/cli.ts:605` — thread the result array through exit-code logic (lines 661-668), preserving human-readable CLI output (each ticket line in output, exit 0 if all synced/hydrated, exit 1 if any blocked/skipped)
- [ ] Test: verify exit code matches current behavior (0 = success, 1 = any failure)

## Dependencies

None — this is an internal refactor with no behaviour change for the human. Independently shippable. Tickets 0008 and 0009 depend on this.

---
generated_by: tracker
task: refactor(tickets): typed per-ticket sync result instead of Promise<string[]>
