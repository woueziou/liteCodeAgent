---
generated_by: implementer
task: "#27"
---

# 0010. Agent-initiated Status push through `sync`

Status: superseded by ADR 0012 (local-first tickets, lot 7/9)
Date: 2026-09-20

> **Note (2026-09-21):** the `Status` push-through-`sync` mechanism this ADR describes
> (`statusEdit()`/`gh project item-edit` in `src/tickets/sync.ts`) no longer exists —
> `status` is now a plain local field on the ticket file, never pushed to or pulled from
> GitHub. This record is left as-is below since it was accurate for the decision it
> captures at the time it was made — see the forthcoming ADR 0012 for the current model.

## Context

Issue #27 asks for two things:

- **Decision 2:** `dispatcher` becomes local-first — it ranks the Backlog from the local
  ticket buffer instead of querying the board directly.
- **Decision 4:** the "only `sync` talks to `gh`" invariant becomes real — direct
  `gh`/board access is removed from `dispatcher`, `implementer`, and `reviewer`, and the
  invariant is checked by test/lint or a runtime guard rather than trusted by convention.

This PR (branch `feat/local-first-dispatcher-sync-only-gh/issue-27`) ships all of decision
2/4: `dispatcher` now ranks from the local buffer, a hydration pass materialises a local
file for any board item that has none (`planTicketHydration`/`applyTicketHydration` in
`src/tickets/sync.ts`, wired into `litecode ticket sync`), and a test
(`tests/agents-sync-only-gh.test.ts`) scans every agent prompt in `packs/core/agents/*.md`
for `gh issue create`/`gh issue comment`/`gh project item-add`/`gh project item-edit` and
fails if one appears outside a named, documented allowlist.

It initially shipped without the piece below, because completing it required resolving a
conflict with an existing decision (ADR 0001) first — that conflict, and the project
owner's resolution of it (since widened beyond what was originally proposed here), is what
the rest of this ADR records.

## The conflict

ADR 0001 records, under "Decisions already made by the project owner (recorded here, not
re-litigated)":

> Status/Priority/Size are pushed to the board exactly once, at ticket creation... After
> creation, those three fields are **pull-only**: `litecode ticket sync`'s pull step reads
> them from the board into the file; the push step never sends them again.

Issue #27's own body describes the intended flow: "`implementer` reads tickets locally; on
pickup it writes the status transition into the local file, then `sync` informs the
board... at the end it updates the file again and `sync` takes over." That flow requires
`sync`'s push step to push `Status` on an already-created ticket — exactly what ADR 0001
says never happens. The two cannot both be true as written.

This is not a corner case that slipped through: ADR 0001 explicitly flags that Status
pull-only-past-creation line as *already decided by the project owner*, not something
`planner`/`implementer` chose and could freely amend. Reversing or narrowing it needs the
same kind of explicit approval, not a unilateral code change buried inside a "local-first
dispatcher" ticket.

## Decision (approved, and widened past what was originally proposed)

The project owner approved the narrow `Status`-only carve-out below, and then explicitly
widened it:

> "Je veux que tout ce qu'il y a comme interaction avec le GitHub Project passe par
> l'agent sync." — every interaction with the GitHub Project, not just Status, goes
> through `sync`. No other agent calls `gh project item-add`/`gh project item-edit` (or
> any other direct GitHub Project mutation) itself, for any field, ever.

That means the decision below is not "Status is special, everything else stays as-is
mechanically" — it's "Status is the one field that is *allowed to change* outside
creation, and *whenever* an agent needs to change any Project field past creation
(Status included), the mechanism is always the same: write the local ticket file, mark it
dirty, let `sync` push it." Concretely:

1. **`Status` becomes push-on-update, but only when the local file is the thing that
   changed it.** `planTicketPull` already skips any ticket that is dirty
   (`!ticket.synced || ticket.pendingComments.length > 0`) — it never overwrites a dirty
   file's fields, by design (see `planTicketPull`'s doc comment). So if `dispatcher`
   writes `ticket.status = "planned"` and marks the file dirty (`synced: false`), the next
   `sync` run's pull step already leaves that value alone. The missing piece was purely on
   the push side: `planTicketSync`'s `update` branch (`src/tickets/sync.ts`) now gains a
   `Status` `FieldEdit` when the ticket's local `status` differs from what `remote` (this
   run's board fetch) just read for that issue. Implemented in this PR — see
   `statusEdit()`/`planTicketSync()` in `src/tickets/sync.ts`.
2. **`Priority`, `Size`, and `Assigned Agent` stay pull-only in the sense that ADR 0001
   already decided: an automated pipeline agent never has an unreviewed opinion on them
   that should silently win over a human's board edit.** They are human-curated fields.
   The widened decision does not make them push-on-update the way Status now is. But if an
   agent genuinely needs to change one of them (the re-plan flow in `dispatcher.md` step 5
   touches Priority/Due Date, for instance), it still never calls `gh project item-edit`
   directly — that path goes through `sync` too, same as everything else. In practice this
   PR does not add a push-on-update mechanism for those three fields (no ticket has asked
   for one), it only removes every agent's ability to call the GitHub Project API for them
   directly; a future ticket that actually needs Priority/Size/Assigned Agent to be
   pipeline-writable would still need its own ADR, because unlike Status those three are
   not pipeline-driven state.
3. **Accepted risk, stated plainly, and explicitly accepted by the project owner with the
   overwrite scenario spelled out to them:** if a human moves the card on the board *and*
   an agent independently marks the same ticket dirty with a different `Status` in the
   same narrow window before the next `sync` run, the agent's local write wins — the
   human's board move is silently overwritten. This is the same class of risk `push`
   already accepted for title/body (an agent's local edit unconditionally overwrites
   whatever's on the board for those two fields, already, with no reconciliation), now
   extended to `Status`. The window is one `sync` cycle. The owner was told this
   explicitly, including that ADR 0001 originally declined this exact risk for Status, and
   chose to accept it rather than have Status moves gated on a live `gh` call from
   whichever agent happens to be driving the pipeline at that moment.

## What this PR implements

- `planTicketSync(tickets, board, remote)` (signature gained a `remote` parameter): for an
  `update` action, computes a `Status` `FieldEdit` via `statusEdit()` when `remote`'s
  Status for that issue disagrees with the ticket's local `status`; empty otherwise
  (including when `remote` has no entry for the issue at all — no diff, no edit, never
  guessed).
- `applyTicketSync(root, plan, board, remote, opts)` (also gained `remote`): resolves the
  board item id for an `update` action straight out of `remote` (already fetched whole-board
  by `fetchTicketItems` earlier in the same `sync` run) and runs any `Status` edit through
  the existing `editField()`/`gh project item-edit` call — still the only place in the
  codebase that ever shells out that command.
- `dispatcher.md` gained `Write`/`Edit` tools; its Backlog→Planned move and `triage.md`'s
  Blocked↔Planned move now write the local ticket file's `status` field instead of calling
  `gh` directly (`triage.md` also gained `Write`/`Edit`).
- `implementer.md`'s Planned→In Progress move (step 2) and its In Progress→Review/Ready to
  Merge move (step 9) do the same — it already had `Write`/`Edit`.
- `tests/agents-sync-only-gh.test.ts`'s `ITEM_ADD_ALLOWED`/`ITEM_EDIT_ALLOWED` now read
  `["sync.md"]` only — the allowlist for both GitHub Project mutation entry points is
  reduced to the one agent the owner named. Every other agent prompt was reworded to
  describe the invariant without the literal `gh project item-add`/`gh project item-edit`
  substring, so the test's plain substring scan actually enforces it rather than
  special-casing prompts that only mention the command in a negated sentence.

`Priority`/`Size` never had a push mechanism past creation before this PR and still don't
— nothing in this PR adds one. `Assigned Agent` is still only ever set at creation
(`creationEdits()`), unchanged.
