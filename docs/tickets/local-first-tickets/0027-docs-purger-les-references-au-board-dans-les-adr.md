---
schemaVersion: 1
id: 0027-docs-purger-les-references-au-board-dans-les-adr
title: docs: purger les références au board dans les ADR, prompts et skills
label: doc
status: inProgress
priority: medium
size: medium
assignedAgent: human
dueDate: 
issue: 
synced: false
syncedAt: 
---

Documentation pass once code stabilizes. Update `docs/decisions/0008` through `0011` (board references), PR comment conventions, and prompt bodies under `packs/` that mention Status/Priority/Size push or `board.json`.

Delete `packs/core/skills/github-project-sync/`.

Update `CLAUDE.md` and the README if they cite `board init`/`board doctor`.

**Coordination**: issue #49 ("prompt bodies assume Claude Code mechanisms on five targets") touches the same prompt files — run this lot in parallel, coordinating to avoid conflicts.

Epic: local-first-tickets
Lot: 7/9
