---
schemaVersion: 1
id: 0028-feat-dashboard-generer-un-dashboard-html-statiqu
title: feat(dashboard): générer un dashboard HTML statique depuis le buffer local
label: feature
status: backlog
priority: medium
size: large
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

New module `src/dashboard/` (one concern per file: `build.ts` for aggregation from `listTickets`, `render.ts` for HTML templating), plus command `litecode dashboard --build` in `src/cli.ts`. Standalone, committable, no server or process.

**Deliberately limited initial scope** (the current state):
- Distribution by status/priority/size
- Recency via `dueDate`
- Grouping by epic
- Dashboard does **NOT** claim to show evolution over time — no transition history exists today (frontmatter only stores `syncedAt`)
- Do not fabricate this data from git history (fragile, slow, out of scope)
- Transition journal design is future work (see ADR 0012)

**Regeneration trigger**: `--build` remains purely explicit, per the rule "no server, no process". Agents `dispatcher`/`implementer` will be documented (in lot 7) to re-run it after any ticket mutation; no enforcement mechanism at this stage. Stale HTML pretending to show current state is worse than no dashboard.

Epic: local-first-tickets
Lot: 8/9
