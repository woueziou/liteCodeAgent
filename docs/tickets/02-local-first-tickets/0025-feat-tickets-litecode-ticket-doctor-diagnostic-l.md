---
schemaVersion: 2
id: 0025-feat-tickets-litecode-ticket-doctor-diagnostic-l
title: feat(tickets): litecode ticket doctor, diagnostic local du buffer
label: feature
status: done
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Build a local diagnostic tool before eliminating its board-based predecessor. `litecode board doctor` is today the **only** operator diagnostic tool; it must have a local equivalent **before** being deleted, never after.

Create new `src/tickets/doctor.ts` exporting `doctor(root, dir)` that validates:
- Frontmatter shape (`TicketSchema.safeParse`)
- Delimiter integrity (reuse existing errors from `parseFrontmatter`)
- Placement within an epic directory

Wire it into `src/cli.ts` as `litecode ticket doctor`, replacing the `board doctor` line in usage text (`cli.ts:85`).

Write tests mirroring the existing coverage of `src/board/doctor.ts` before deleting that module.

**Real motivation**: a ticket file lost its opening `---` delimiter this week, written by an agent via `Edit` rather than through the CLI; only `sync` caught it by rejecting it outright. Without the board, nothing else plays that role.

Epic: local-first-tickets
Lot: 5/9
