---
schemaVersion: 1
id: 0023-fix-tickets-ticketfiles-doit-parcourir-recursive
title: fix(tickets): ticketFiles doit parcourir récursivement les répertoires d'epic
label: bug
status: done
priority: high
size: medium
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

Fix silent data loss when tickets are organized into epic directories. `src/tickets/store.ts:11-19` (`ticketFiles`) performs a flat `readdir(abs)` filtered on `.endsWith(".md")`. With a structure `docs/tickets/<epic>/<ticket>.md`, it returns **zero entries** — subdirectories do not end in `.md` and `readdir` is not called with `{ recursive: true }`.

**Consequence**: all tickets silently disappear from `listTickets`, from the `nextNumber` calculation in `createTicket`, and from deduplication candidates.

**Fix**: rewrite with recursive traversal; adapt `listTicketsDetailed` (line 36, `join(dir, file)`) so that `ticket.path` reflects the nested path.

**Tests to add**:
- Listing epics in nested directories
- Empty epic directories
- `nextNumber` and dedup candidate scanning across multiple epics

**Must precede** any physical file movement.

Epic: local-first-tickets
Lot: 3/9
