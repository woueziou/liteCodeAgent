---
schemaVersion: 2
id: 0001-fix-board-detect-non-editable-derived-project-fi
title: fix(board): detect non-editable derived project fields at plan time instead of failing mid-apply
label: bug
status: done
priority: high
size: medium
assignedAgent: implementer
dueDate: 
---

## Problem

Running board init/sync against an existing org project (Fuel Manager Project, https://github.com/orgs/kp-dev-org/projects/2, node `PVT_kwDODdLm7c4Bj5kj`) plans:

```
update   Priority add option(s): Low, Medium, High (existing ids preserved)
update   Size add option(s): Trivial, Small, Medium, Large (existing ids preserved)
remove   Size remove unused option(s): XS, S, M, L, XL (no item holds them)
```

then crashes mid-apply:

```
gh api graphql --input - failed (exit 1):
gh: Only custom fields can be updated. Fields derived from issues or pull requests must be updated through their respective APIs.
```

Root cause: `planBoard` in `src/board/init.ts` matches project fields purely by name (`byName.get(spec.name)`, ~line 78) and only validates `remote.dataType !== DATATYPE[spec.kind]` (~lines 91-98). Nothing checks the matched field is a mutable *custom* field, so `updateProjectV2Field` is issued against GitHub-derived fields and rejected. The crash leaves the project partially mutated with a stale `board.json`.

## Plan

1. `src/board/query.ts` — export a `DERIVED_DATATYPES` set of non-editable `ProjectV2FieldCommon.dataType` values: `ASSIGNEES, LABELS, LINKED_PULL_REQUESTS, MILESTONE, REPOSITORY, REVIEWERS, TITLE, TRACKED_BY, TRACKS`. `RemoteField.dataType` is already `string`. Comment the known limitation: `PROJECT_FRAGMENT` (lines 22-32) only distinguishes `ProjectV2Field`/`ProjectV2SingleSelectField`/`ProjectV2IterationField`, so a SINGLE_SELECT-shaped system field isn't caught by this set alone.
2. `src/board/init.ts` — in `planBoard`, right after the `byName.get(spec.name)` match and *before* the dataType/kind comparison, guard on `DERIVED_DATATYPES.has(remote.dataType)`: push a `Blocker` (existing `{ field, problem, fix }` shape, line 31) and `continue`, emitting zero actions. Suggested fix text: "Field '<name>' cannot be edited via the API — recreate it as a plain custom single-select in the Project UI". Keeping the check in `planBoard` means `applyBoardPlan`'s plan/re-plan/verify cycle (lines 270-330, re-fetch 282-292) catches a collision that only appears on re-fetch, preserving the "never mutate on a stale assumption" invariant.
3. Create-field path (lines 240-262) needs no separate guard — it only fires when there is no name collision (`!remote`). Add a comment recording that the guard lives solely in `planBoard`; confirm in review no direct `createProjectV2Field`/`graphql` call bypasses `planBoard`'s action list.
4. Harden the per-field option-update loop (lines 300-313): currently no per-field try/catch, while `board.json` is written only at the end (line 374). Wrap the `graphql(UPDATE_SELECT_FIELD, ...)` call; on failure throw an error carrying the field name, the already-succeeded log entries ("Fields already updated before failure: ..."), and the original message.
5. Re-wrap the caught error at the init.ts call site (~line 305) as `Field '<name>': <err.message>` rather than touching `src/board/gh.ts` — `run()` (line 116) re-throws via `summarize()` (line 42), which redacts the mutation body to `query=…`; changing that redaction would alter the contract for all callers.
6. Tests (bun test; check for an existing `init.test.ts` first, otherwise create alongside `init.ts`):
   - `planBoard` with a `RemoteField` fixture of `dataType: "ASSIGNEES"` (and `"TITLE"`) matching a `FIELD_SPECS` name → returns a blocker, zero actions.
   - Regression: `applyBoardPlan` issues no `UPDATE_SELECT_FIELD`/`CREATE_SELECT_FIELD` graphql call for such a field.
   - Partial-apply: second field's mutation rejects → thrown error message contains the first field's success log entry.
7. `bun run check` and `bun test` must pass.

## Explicitly rejected

Auto-recreating the field under a different custom name (configurable or not). `src/tickets/sync.ts` does literal `field(board, "Priority")` / `field(board, "Size")` (lines 56-57) and `item.fields.get("Priority")` / `item.fields.get("Size")` (lines 308, 313); a renamed field makes those return `undefined` and silently degrades ticket sync. A configurable fallback name would need threading through `config.ts` into both `board/init.ts` and `tickets/sync.ts`, doubling drift surface. Blocker-and-stop keeps `FIELD_SPECS` the single source of truth and fails loudly at board-init time.

## Contract impact

No new `Action` discriminant (the fix emits no action). In-repo consumers of these types: `src/cli.ts`, `src/tickets/{sync,spec,remote}.ts`; nothing re-exported externally. Plan output is human-facing CLI stdout (cli.ts:443-476), not a machine-parsed contract.

## ADR

\`docs/decisions/0002-reject-derived-project-fields-in-board-planning.md\` (precedent: \`0001-local-ticket-buffer-and-github-sync.md\`). Record: where detection lives (planBoard vs pre-apply) and why re-checking every cycle is required; the enumerated derived-dataType set and how it stays in sync as GitHub adds types; why a collision is a hard Blocker rather than a silent skip, and why auto-rename was rejected; acceptance that the dataType guard is necessary-but-not-sufficient given PROJECT_FRAGMENT's three-shape limitation, plus the blast radius if a SINGLE_SELECT-shaped system field slips through.

---

generated_by: tracker
