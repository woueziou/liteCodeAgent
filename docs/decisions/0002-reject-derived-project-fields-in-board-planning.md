---
generated_by: implementer
task: "#13"
---

# 0002. Reject derived project fields in board planning

Status: superseded by ADR 0012 (local-first tickets, lot 7/9 — not yet written)
Date: 2026-09-18

> **Note (2026-09-21):** `src/board/init.ts` and the whole `litecode board` command
> family this ADR is about no longer exist — the GitHub Project board planning mechanism
> was removed from the codebase entirely. This record is left as-is below since it was
> accurate for the decision it captures at the time it was made — see the forthcoming
> ADR 0012 for the current model.

## Context

Running `litecode board init`/`sync` against an existing org project (Fuel Manager
Project, `PVT_kwDODdLm7c4Bj5kj`) planned option updates for `Priority` and `Size`, then
crashed mid-apply:

```
gh api graphql --input - failed (exit 1):
gh: Only custom fields can be updated. Fields derived from issues or pull requests must be
updated through their respective APIs.
```

`planBoard` (`src/board/init.ts`) matched project fields purely by name and only checked
that the remote field's `dataType` matched the *kind* the spec expected
(`single-select`/`text`/`date`). It never checked whether the matched field was a mutable
*custom* field at all. A first pass (`DERIVED_DATATYPES`, below) caught fields GitHub
reports under an unambiguous derived `dataType` such as `ASSIGNEES` or `TITLE` — but the
actually-failing mutation here was `updateProjectV2Field` on `Priority`, and a follow-up
GraphQL debug/introspection pass against the live board established the real root cause,
which the original diagnosis got wrong:

- `Priority` reports `__typename: ProjectV2SingleSelectField`, `dataType: "SINGLE_SELECT"`,
  and has **zero options**. That is indistinguishable from a genuine custom single-select by
  `dataType` alone, so `DERIVED_DATATYPES` never catches it and the plan proceeds to attempt
  the mutation, which GitHub then rejects.
- `Size`, by contrast, is **not** a derived field at all (`isIssueField: false`) and would
  have updated fine. The run only ever aborted on `Priority`, before reaching `Size` — the
  original narrative that "Priority and Size are both non-editable template fields" was
  incorrect; `Size` was misdiagnosed as part of the same failure purely because it never got
  a chance to run.
- GitHub does expose an exact discriminator the original fix ignored: `isIssueField: Boolean`
  on `ProjectV2FieldCommon` (present on `ProjectV2Field` and `ProjectV2SingleSelectField`;
  `null` on `ProjectV2IterationField`). Confirmed via live introspection and query against
  the reporting board: `isIssueField: true` for `Priority`, `Start date`, `Target date`;
  `isIssueField: false` for `Status`, `Size`, `Assigned Agent`, `Due Date`, and every
  `DERIVED_DATATYPES` field.

## Decision: where detection lives, and why it must re-run every cycle

The guard lives in `planBoard`, immediately after the by-name field match and before the
existing dataType/kind comparison — not as a one-off pre-apply check. `applyBoardPlan`
already re-invokes `planBoard` against a freshly re-fetched project both mid-run (before
issuing option-update mutations) and post-apply (to verify nothing is left outstanding).
Putting the check inside `planBoard` means every one of those cycles re-derives it for
free, so a collision that only appears on re-fetch is caught by the same mechanism, rather
than needing a second, easily-forgotten call site. This is the same reasoning the codebase
already applies to `remote.dataType !== DATATYPE[spec.kind]`: correctness lives in the pure
planning function, and every caller inherits it by construction.

## Decision: two complementary checks, not one

`src/board/query.ts` exports `DERIVED_DATATYPES`, a `Set` of `ProjectV2FieldCommon.dataType`
values GitHub computes from the issue/PR rather than storing as an independent field value:
`ASSIGNEES, LABELS, LINKED_PULL_REQUESTS, MILESTONE, REPOSITORY, REVIEWERS, TITLE,
TRACKED_BY, TRACKS, PARENT_ISSUE, SUB_ISSUES_PROGRESS, CREATED, UPDATED, CLOSED` (the last
five added after the live-board investigation surfaced them as additional derived
dataTypes not previously enumerated). This catches every field GitHub marks with an
unambiguous derived `dataType`.

It cannot catch `Priority`-shaped fields, because those report an ordinary
`dataType: "SINGLE_SELECT"`. `planBoard` therefore also checks `remote.isIssueField ===
true` as a second, independent guard. The two checks are complementary rather than
redundant: every field `DERIVED_DATATYPES` catches also reports `isIssueField: false` on
the live board, so neither check subsumes the other — dropping either one reopens a real
gap. The `isIssueField` blocker carries its own message, because the remedy differs from a
`DERIVED_DATATYPES` collision: an issue-derived field's options live on the issue itself
and must be managed through the issues API or repo settings, not the project, so the
actionable fix is to rename/remove the project-level field (or rename the spec field)
rather than "recreate it as a plain custom field in the Project UI."

## Decision: a collision is a hard Blocker, not a silent skip or auto-rename

Two alternatives were considered and rejected:

- **Silently skip the field** (emit no action, no blocker): this would leave the pipeline
  quietly unable to track Priority/Size/whatever collided, with no signal to a human until
  something downstream (`tickets/sync.ts` reading `item.fields.get("Priority")`) breaks in
  a much more confusing way, far from the actual cause.
- **Auto-recreate the field under a different name**: rejected explicitly. `src/tickets/sync.ts`
  looks up fields by their exact spec name in multiple places (`field(board, "Priority")`,
  `field(board, "Size")`, `item.fields.get("Priority")`, `item.fields.get("Size")`). A
  renamed field breaks those lookups silently. Making the fallback name configurable would
  require threading a new option through `config.ts` into both `board/init.ts` and
  `tickets/sync.ts`, doubling the surface area that can drift out of sync. Blocking keeps
  `FIELD_SPECS` the single source of truth for field names project-wide.

So both guards push a `Blocker` with a human-actionable fix and fail loudly at plan time,
before any mutation is attempted — consistent with every other blocker `planBoard` already
raises.

## Residual limitation (narrowed from the original)

The original version of this ADR described the `Priority`/`Size` scenario as a hypothetical
future risk ("if GitHub ever ships a derived field shaped like `ProjectV2SingleSelectField`
..."). It was not hypothetical — it was the exact bug reported in #13 — and `isIssueField`
now closes it directly, confirmed by the reproduction added in `tests/board.test.ts`
(`Priority`, `dataType: SINGLE_SELECT`, `options: []`, `isIssueField: true` → blocked, zero
actions).

What remains unhandled: `PROJECT_FRAGMENT` still only distinguishes three GraphQL field
shapes (`ProjectV2Field`, `ProjectV2SingleSelectField`, `ProjectV2IterationField`), and
`isIssueField` is only defined on `ProjectV2FieldCommon` as of this writing. If GitHub ever
introduces a *different* non-editable field category that reports neither a
`DERIVED_DATATYPES` dataType nor `isIssueField: true`, it would still slip through
undetected and fail at the `UPDATE_SELECT_FIELD` mutation — caught by the `try`/`catch`
already in place around that call (which reports which fields already succeeded rather than
leaving the caller to guess), not by `planBoard`. No such category is known to exist today;
if one surfaces, extend `DERIVED_DATATYPES` or add a further discriminator the same way
`isIssueField` was added here.
