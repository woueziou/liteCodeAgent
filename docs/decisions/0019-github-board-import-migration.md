---
generated_by: implementer
task: "0050"
---

# 0019. `ticket import-board`: a one-time exit from the GitHub Project board

Status: accepted
Date: 2026-09-28

## Context

ADR 0015 made tickets purely local. ADR 0012 removed `board init`/`board doctor`.
`litecode upgrade` and `ticket migrate` cover the file-format side of that migration
(schema v1 → v2), but neither ever reads the GitHub Project (v2) board itself: a project
that configured `project.board.number` and kept using the board past that cutoff has
items — some backed by an issue, some drafts with none — that exist only there, with no
local ticket file at all. There has been no path to bring them into the local buffer.

This is a one-time migration for users who stayed on the old board mode for a long time
without migrating (orchestrator's 2026-09-28 panel synthesis, blocked-compatible), not a
sync: once run, the board and the local buffer are not kept in agreement with each other
going forward. Decisions below were validated by the owner on 2026-09-28.

## Decision

1. **A new, standalone subcommand: `litecode ticket import-board [--apply]`.** It is not
   folded into `ticket migrate`, whose contract (schema-version rewrite of files already
   local) does not change. Simulation by default; `--apply` writes. Read-only on GitHub in
   both modes — nothing about an issue or project item is ever written, closed, or
   otherwise modified. Source: the Project v2 named by `project.board.number`, its items'
   custom fields (status/priority/size), and the linked issues, read via a read-only
   function in `src/gh.ts` (`readBoardItems`) that reuses the existing `gh()` wrapper's
   rate-limit handling rather than shelling out on its own.

2. **A new optional `TicketSchema` field, `importedFrom`** (`KEY_ORDER`, immediately after
   `dueDate`): `github:owner/repo#123` for a ticket imported from an issue-backed item,
   `github-project-item:<id>` for one imported from a draft item with no issue. It is never
   written by anything other than `import-board`, never placed in `extraFrontmatter`, and
   never removed once set — it is the ticket's permanent record of where it came from, and
   the key idempotence (next point) compares against.

3. **Idempotence is an exact string match on `importedFrom`.** Before creating a ticket for
   a board item, `import-board` checks whether any local ticket already carries that exact
   `importedFrom` string; if so, the item is skipped, unconditionally — even if the source
   issue's title/body/fields changed since. Nothing is ever overwritten. This also makes an
   interrupted run resumable for free: re-running only ever acts on items not yet imported,
   with no separate checkpoint state to maintain.

4. **An out-of-enum field value never blocks the import; it forces a clarification
   instead.** When a board item's status, priority, or size value doesn't match a local
   enum (case/label-insensitive), the ticket is still created — in `backlog`, regardless of
   which field(s) were unmapped — with an `[À CLARIFIER]` note in the body citing the
   original value(s) (ticket 0035's marker, which already blocks `ticket move ... planned`
   until a human resolves it). A recognized value on every field maps the ticket's
   `status`/`priority`/`size` directly.

5. **The body contract (0035) is honored even when the source doesn't cooperate.** If an
   issue's body already carries all four `## <heading>` sections with content, that
   structure is kept as-is. Otherwise: the whole body goes under `## Contexte` (or a
   placeholder line if it's empty), `## Critères d'acceptation` gets
   `[À CLARIFIER] critères à définir (importé de #N)`, and — since "no section is ever
   empty" rules out leaving them blank — `## Plan` and `## Hors périmètre` get an
   equivalent `[À CLARIFIER]` placeholder each.

6. **Per-item isolation, with a final tally.** One item failing (a write error, a
   malformed field) does not stop the run; the loop continues and that item is reported as
   failed, with its reason. The command ends with a count of imported/skipped/failed items,
   listing each item's outcome — not just a pass/fail exit code.

7. **Writes go through `createTicket`/`writeTicketExclusive`** (`src/tickets/store.ts`),
   same as every other ticket-creating path, so the same collision-safe numbering and
   exclusive-write guarantees apply. Imported tickets are committed on the default branch
   like any other ticket change (not a special case).

8. **`litecode upgrade` only points at the command; it never runs it — and `cleanConfig`
   keeps `project.board` in place until the user has actually run it.** When
   `project.board.number` is still configured, `upgrade`'s plan lists a skip entry naming
   `ticket import-board` and what it's for. Importing is a one-time, human-approved action
   with judgment calls baked into it (what to do with an unmapped field, what a malformed
   body becomes) — not something an unattended `upgrade --apply` should decide on someone's
   behalf. Since `project.board` is itself one of `cleanConfig`'s obsolete keys, this check
   reads the config file directly rather than the config `upgrade`'s later migrations plan
   against (which has already had `board` stripped) — the same reason `removeLegacyData`
   already reads raw config for `board.dataFile`.

   `cleanConfig` only removes `project.board` when `project.board.number` is *unset*; a
   `board` with a `number` is left as-is. An unconditional strip (this decision's original
   text) meant `upgrade --apply` deleted `project.board.number` before the very
   `ticket import-board` it had just recommended could read it, so the skip entry pointed
   at a command that would immediately fail with "project.board.number is not configured."
   `ticket import-board` also accepts `--board <owner>/<number>` — not `--project`, which
   is already this CLI's global "target repo directory" flag — to override config
   directly, for a project whose config was already cleaned by an earlier litecode release
   before this fix.

## Consequences

- A project that imports late still gets every board item's issue/draft content, at the
  cost of losing the original board's live status if it wasn't already reflected in a
  recognized field value (falls back to `backlog` + a clarification note instead).
- `importedFrom` is a one-way marker, not a link that's kept live: nothing revisits an
  imported ticket if the source issue changes afterward (out of scope — no continuous or
  bidirectional sync, per the ticket).
- A human still has to review every `backlog`-with-`[À CLARIFIER]` ticket before it can be
  planned; import-board deliberately does not guess a pipeline status or acceptance
  criteria it can't derive safely from the source data.
- `project.board` remains referenced by one code path (`import-board`) after this ticket,
  which is why `upgrade`'s `cleanConfig` migration keeps a project's `project.board` value
  in config, rather than removing it, for as long as `project.board.number` is set — a
  human removes it themselves, after running `import-board`, per the `board-import`
  suggestion's own text (point 8). A `board` with no `number` (already cleaned, or never
  really configured) is still removed by `cleanConfig` as before.
