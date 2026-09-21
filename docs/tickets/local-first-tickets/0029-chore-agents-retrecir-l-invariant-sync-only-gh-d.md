---
schemaVersion: 1
id: 0029-chore-agents-retrecir-l-invariant-sync-only-gh-d
title: chore(agents): rétrécir l'invariant sync-only-gh de l'issue #44 à la surface survivante
label: chore
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

Issue #44 tracks an invariant ("only `sync` talks to GitHub", verified only by prompt scan) half of which vanishes with this initiative. The invariant is not obsolete — it must be **narrowed**, not closed — reframed to the surviving surface: the relocated `gh()` wrapper (lot 1) and `fetchOpenIssueDedupeCandidates` in `dedupe.ts`.

**Handle after lot 6** to verify the invariant against sites of actual survival rather than assumptions.

Epic: local-first-tickets
Lot: 9/9
