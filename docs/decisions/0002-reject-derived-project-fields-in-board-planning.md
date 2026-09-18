---
generated_by: implementer
task: "#13"
---

# 0002. Reject derived project fields in board planning

Status: proposed
Date: 2026-09-18

## Context

Running `litecode board init`/`sync` against an existing org project (Fuel Manager
Project, `https://github.com/orgs/kp-dev-org/projects/2`) planned option updates for
`Priority` and `Size`, then crashed mid-apply:

```
gh api graphql --input - failed (exit 1):
gh: Only custom fields can be updated. Fields derived from issues or pull requests must be
updated through their respective APIs.
```

`planBoard` (`src/board/init.ts`) matched project fields purely by name and only checked
that the remote field's `dataType` matched the *kind* the spec expected
(`single-select`/`text`/`date`). It never checked whether the matched field was a mutable
*custom* field at all. So a name collision with a GitHub-derived field (one system
auto-populates from the issue/PR itself, e.g. `Assignees`, `Labels`, `Milestone`) produced
a plan that looked normal, then was rejected by the GraphQL mutation itself — after
`board.json` may already have been left in a stale, partially-applied state.

## Decision: where detection lives, and why it must re-run every cycle

The guard lives in `planBoard`, immediately after the by-name field match and before the
existing dataType/kind comparison — not as a one-off pre-apply check. `applyBoardPlan`
already re-invokes `planBoard` against a freshly re-fetched project both mid-run (before
issuing option-update mutations) and post-apply (to verify nothing is left outstanding).
Putting the check inside `planBoard` means every one of those cycles re-derives it for
free, so a collision that only appears on re-fetch — e.g. the field's underlying type
changed between the initial plan and the apply — is caught by the same mechanism, rather
than needing a second, easily-forgotten call site. This is the same reasoning the codebase
already applies to `remote.dataType !== DATATYPE[spec.kind]`: correctness lives in the pure
planning function, and every caller inherits it by construction.

## Decision: the enumerated derived-dataType set, and how it stays in sync

`src/board/query.ts` exports `DERIVED_DATATYPES`, a `Set` of `ProjectV2FieldCommon.dataType`
values GitHub computes from the issue/PR rather than storing as an independent field value:
`ASSIGNEES, LABELS, LINKED_PULL_REQUESTS, MILESTONE, REPOSITORY, REVIEWERS, TITLE,
TRACKED_BY, TRACKS`. This list is GitHub's enum of derived field types as of this writing,
not a full mapping of every `ProjectV2FieldType` — there is no API that classifies
"editable vs derived" directly, so the set has to be maintained by hand against GitHub's
GraphQL schema/changelog. If GitHub adds a new derived type in the future, a name collision
with it would currently fall through to the ordinary dataType/kind blocker instead (still a
blocker, just with a less specific message) rather than silently being accepted — the
failure mode of an unmaintained set is a slightly worse error message, not a crash mid-apply.

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

So the guard pushes a `Blocker` with a human-actionable fix ("recreate it as a plain custom
single-select in the Project UI") and fails loudly at plan time, before any mutation is
attempted — consistent with every other blocker `planBoard` already raises.

## Accepted limitation: the guard is necessary, not sufficient

`PROJECT_FRAGMENT` in `src/board/query.ts` only distinguishes three GraphQL field shapes:
`ProjectV2Field`, `ProjectV2SingleSelectField`, and `ProjectV2IterationField`. If GitHub
ever ships a derived field that is *shaped* like `ProjectV2SingleSelectField` (i.e. reports
`dataType: "SINGLE_SELECT"` while still being non-editable), it would not appear in
`DERIVED_DATATYPES` under a distinguishable dataType and would slip past this guard
undetected — the mutation would then fail mid-apply again, exactly as before this fix,
though now scoped to a single field's option-update call rather than the whole run, and
caught immediately by the `try`/`catch` added around that call (which reports which fields
already succeeded rather than leaving the caller to guess). No fields of this shape are
known to exist as of this writing; if one is discovered, `DERIVED_DATATYPES` should be
extended, or the guard should additionally special-case known field names GitHub reserves
(e.g. `Status` is not reserved, but hypothetical system fields might be).
