---
schemaVersion: 1
id: 0028-feat-dashboard-generer-un-dashboard-html-statiqu
title: feat(dashboard): générer un dashboard HTML statique depuis le buffer local
label: feature
status: review
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

<!-- litecode:comment -->
PR #57 (https://github.com/woueziou/liteCodeAgent/pull/57, branch `feat-dashboard/issue-0028`) opened. `reviewer` verdict: **changes-requested**.

VERDICT: changes-requested

CHECK_OUTPUT:
- `bun run check` (tsc --noEmit): clean, no output/errors.
- `bun test`: 156 pass, 0 fail, 832 expect() calls, across 22 files (incl. tests/dashboard-build.test.ts and tests/dashboard-render.test.ts, 11 tests total for this feature).

FINDINGS:
- (process, blocking per skill instructions) The `code-review` skill was invoked (`--effort low` against pr-57-review vs main) and launched as a background sub-pass (`@code-review-2`), but did not return a result within this review turn's budget. I did not substitute my own manual correctness read in its place. Per the reviewer's own rules, a review whose correctness pass never actually completed must be capped at `changes-requested`, not `approve`/`approve-with-notes`, so this verdict reflects that — not a specific bug found by me.
- (non-blocking, scope) The ticket's stated scope explicitly lists "Recency via `dueDate`" as one of three initial axes (status/priority/size distribution, recency via dueDate, grouping by epic). The shipped `build.ts`/`render.ts` implement status/priority/size/label/epic breakdown, a blocked-ticket callout, and a full per-ticket list, but there is no dueDate/recency section anywhere in `DashboardData` or the rendered HTML. Given `dueDate` is optional and often empty on tickets in this repo, and the ticket's headline ask ("générer un dashboard HTML statique" showing current state) is otherwise fully met, I judge this a reasonable scope interpretation rather than a blocking gap — but flagging it explicitly since the ticket text names it directly.
- No other issues found in the reviewer's own read: `escapeHtml`/`escapeAttr` applied consistently to every interpolation of ticket-derived free text (title, body, id, priority, size, label, status label, epic name, loadError path/message). Output is a single self-contained `<!doctype html>` document, no external network reference. No time-series/trend data fabricated. `readyToMerge`/`done` kept visually distinct; blocked tickets get a dedicated alert section. One-concern-per-file honored. `.gitignore` addition for `docs/dashboard.html` justified inline (a committed snapshot would go stale).
- Commit d581e9e correctly carries `Agent: implementer` / `Task: 0028-...` trailers.

PLAN_FIDELITY: matches, with one caveat — the dueDate/recency axis named in the ticket's stated scope was not implemented (non-blocking, see above); everything else matches what was built.

REENTRY:
- code-review sub-pass not returning: same-PR fixup — re-run `code-review --effort low` (or `medium`) against the branch before this PR is approved, and fold its findings in before merge. Process gap, not a code defect.
- dueDate/recency gap: no action required to block this PR; a lightweight follow-up ticket (default priority) would cover adding a recency/dueDate section as a small addition, not a rework.
<!-- /litecode:comment -->

