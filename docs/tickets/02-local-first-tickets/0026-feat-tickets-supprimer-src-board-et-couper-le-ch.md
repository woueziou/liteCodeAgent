---
schemaVersion: 1
id: 0026-feat-tickets-supprimer-src-board-et-couper-le-ch
title: feat(tickets)!: supprimer src/board/ et couper le chemin d'hydratation
label: feature
status: done
priority: high
size: large
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

**Atomic lot** — an intermediate state where `sync.ts` still imports `board/*` while `board/` is gone will not compile. Deliver in one PR, with no further subdivision.

**Content**: delete `src/board/` (`doctor.ts`, `init.ts`, `query.ts`, `spec.ts`; `gh.ts` already moved in lot 1, enums already moved in lot 2).

In `src/tickets/sync.ts`:
- Remove `planTicketPull`/`applyTicketPull`/`planTicketHydration`/`applyTicketHydration`/`fetchTicketItems`
- Remove all `board: BoardData` and `remote: Map<number, RemoteItem>` parameters from `planTicketSync`/`applyTicketSync` — these are hard failures at lines 69 and 137
- Push only survives: `creationEdits` no longer writes `priority`/`size`/`assignedAgent` to the board; `FieldEdit`/`editField`/`gh project item-add`/`item-edit` vanish; `gh issue create`/`gh issue comment` remain
- Status ceases to sync to the board: it becomes a purely local pipeline state written by `dispatcher`/`implementer`/`triage`

Delete `src/tickets/remote.ts` (exists only to read board items).

Rewrite the module comment of `src/tickets/spec.ts:1-24` — the framing "GitHub is authoritative / pull-only" disappears.

Clean `src/init.ts` and `src/cli.ts` (5 sites: `board init`/`board doctor` commands, imports lines 9-14, usage text lines 84-85, dispatch), wiring in `ticket doctor` from lot 5.

**Breaking change**: two documented CLI commands disappear for bunx/npm consumers with no deprecation window — this repo uses semantic-release with Conventional Commits, justifying a MAJOR bump, hence the `!` in the title.

Epic: local-first-tickets
Lot: 6/9
