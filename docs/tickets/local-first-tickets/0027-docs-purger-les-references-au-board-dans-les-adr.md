---
schemaVersion: 1
id: 0027-docs-purger-les-references-au-board-dans-les-adr
title: docs: purger les références au board dans les ADR, prompts et skills
label: doc
status: readyToMerge
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

<!-- litecode:comment -->
Two follow-up commits added on PR #58 (https://github.com/woueziou/liteCodeAgent/pull/58, branch `docs/purge-board-refs/issue-0027`):

1. `9b73c96` — removed a leftover dead reference to the deleted `github-project-sync` skill from README.md's pack list.
2. `f3d8743` — pre-empted a merge conflict with sibling PR #56 (both independently touched the same lines of `tests/agents-sync-only-gh.test.ts`): merged both PRs' intents onto this branch (empty `ITEM_ADD_ALLOWED`/`ITEM_EDIT_ALLOWED`, purged `SKILL_ITEM_MUTATION_ALLOWED`/comments of stale board/skill references), then reverted #56's own edit to that file so it no longer conflicts regardless of merge order. Confirmed conflict-free via `git merge-tree` in both directions.

`reviewer` verdict on both commits: **approve**, no findings. `bun run check` clean, `bun test` 145 pass / 0 fail. Full verdict text posted verbatim on the PR: https://github.com/woueziou/liteCodeAgent/pull/58#issuecomment-5767042909

Status already at Ready to Merge; PR shows no merge conflicts.
<!-- /litecode:comment -->
