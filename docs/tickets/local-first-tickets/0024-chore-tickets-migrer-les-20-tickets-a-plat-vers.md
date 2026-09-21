---
schemaVersion: 1
id: 0024-chore-tickets-migrer-les-20-tickets-a-plat-vers
title: chore(tickets): migrer les 20 tickets à plat vers les répertoires d'epic
label: chore
status: inProgress
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

One-time data migration, not source code. Move the 20 existing `docs/tickets/NNNN-xxx.md` files to `docs/tickets/<epic>/NNNN-xxx.md`.

**Blocked** until the epic grouping scheme is settled — several of the 20 existing tickets do not obviously belong to any single epic. Options to be decided by the repo owner (see ADR 0012):
- Arbitrary bucket
- "Miscellaneous" epic
- Manual per-file decision

**Depends on** lot 3 (the recursive reader must exist before files are moved).

**After migration**: verify via `litecode ticket list` that all 20 still parse.

**⚠️ Breaking reference links**: flat paths `docs/tickets/NNNN-xxx.md` are cited in ADRs 0008–0011 and in PR comments — these become dead links. Plan an explicit migration note or an acknowledged cutoff date.

Epic: local-first-tickets
Lot: 4/9
