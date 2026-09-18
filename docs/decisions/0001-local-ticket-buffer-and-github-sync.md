---
generated_by: implementer
task: "#10"
---

# 0001. Local ticket buffer and GitHub sync

Status: proposed
Date: 2026-09-18

## Context

Tickets used to be created directly against GitHub by `tracker`, one scattered `gh` call
per field. That put every agent's own `gh issue create` / `item-add` / `item-edit` calls
on the critical path for hitting GitHub's secondary rate limit — already the cause of
incidents in this repo (`project.lessons` in `litecode.config.json`).

Issue #10 introduces a local ticket buffer under `docs/tickets/`: a ticket is drafted as a
markdown file (title, body, label, plus a `synced` dirty flag) with no GitHub call at
draft time, and a new `litecode ticket sync` command pushes the whole dirty batch to
GitHub in one bounded, retryable run. `tracker` no longer calls `gh` at all; a new `sync`
agent owns the batch push.

## Decisions already made by the project owner (recorded here, not re-litigated)

- **Status/Priority/Size are pushed to the board exactly once, at ticket creation.** The
  board does not know about the item before that point, so there is nothing to conflict
  with. After creation, those three fields are **pull-only**: `litecode ticket sync`'s
  pull step reads them from the board into the file; the push step never sends them
  again. A ticket file re-asserting a stale status on every sync would fight a human who
  moved the card — GitHub stays the single source of truth for pipeline state, full stop.
- **`litecode ticket sync` runs pull, then push, by default** (no flag needed to get this
  order; there is no supported way to push without first pulling). A push must never
  overwrite board state a run has not read yet.

## Decisions this ADR makes

### 1. `schemaVersion` policy and migration

**Decision:** `schemaVersion` is a plain integer, first key in a ticket file's
frontmatter, defaulting to `1` when absent (a hand-written or pre-existing file with no
`schemaVersion` key is treated as version 1, not rejected). There is no migration
tooling yet, because no ticket file has ever been committed under a different shape —
version 1 is the only shape this feature has ever shipped.

The policy for when a migration *would* be needed: a future change to the on-disk shape
that an existing committed file would not already satisfy (e.g. renaming a frontmatter
key, changing what a field means) must bump `CURRENT_SCHEMA_VERSION` in
`src/tickets/spec.ts` and add a migration step to `listTicketsDetailed`/`parseTicket`
that upgrades an older `schemaVersion` in memory before validation — not a one-off script
run by hand across `docs/tickets/`. This keeps the migration path exercised by the same
code path as normal reads, so it can't silently rot.

**Why not a separate `litecode ticket migrate` command today:** speculative tooling for a
migration path that has never been needed is exactly the kind of complexity this project
avoids elsewhere (see `board`'s "add options in the UI" refusal, rather than automating
something rare and destructive). Build the migration step in `spec.ts`/`store.ts` when the
first real shape change actually happens.

### 2. Throttling between `gh` calls

**Decision:** a proactive delay between mutating `gh` calls within `applyTicketSync`,
configurable via the `LITECODE_TICKET_SYNC_DELAY_MS` environment variable, falling back to
a `delayMs` option on `SyncOptions`, falling back to a conservative default of 250ms.

**Why an env var over a `litecode.config.json` key:** the value that matters here is
per-run/per-environment (a CI job batching many tickets wants a different pace than an
interactive human running one `ticket new` + `ticket sync`), and `board/gh.ts`'s existing
retry/backoff knobs (`LITECODE_GH_RETRIES`, `LITECODE_GH_BACKOFF_MS`) are already env vars
for the same reason — a config key would put a rate-limit tuning knob in committed,
per-project state, when it is closer to an operational concern than a project-identity
one. Keeping it as an env var also means it composes for free with `onGhRetry`'s
post-failure backoff: proactive throttling reduces how often the reactive path is needed,
it doesn't replace it.

### 3. Tool surface remaining on `tracker`

**Decision:** `tracker` keeps `Bash` (to run `litecode ticket new`, a local file write with
no network call) and `Read` (to double-check a referenced path, e.g. an ADR path, before
putting it in the ticket body). It loses nothing else, because it never had a different
tool surface — `gh` was never a declared tool, only an assumed capability of `Bash`. What
changes is normative, not mechanical: `tracker.md` now says explicitly not to reach for
`gh` in any form, and the `github-project-sync` skill states plainly that new-ticket `gh`
calls belong to `sync`. This is enforced by convention/description, not by tool
restriction, because `Bash` is needed for the legitimate `litecode ticket new` call and
sandboxing "this Bash but not that gh invocation" is not a capability the harness has.

### 4. What still reaches the board as an item-edit vs. a pure issue call

**Decision:**

- **Creation** (`ticket.issue` unset): `gh issue create`, `gh project item-add`, then
  `item-edit` for Status, Priority, Size, Assigned Agent, and (if set) Due Date — the full
  set, once.
- **Every sync after creation**: `gh issue edit` (title/body) and `gh issue comment`
  (staged comments) only. No `item-edit` call is ever made for an already-created ticket
  by the push path — Status/Priority/Size/Assigned Agent are read-only from the push
  side, matching the pull-only decision above. If a project genuinely needs to push
  `assignedAgent` again after creation (e.g. reassigning), that is a deliberate future
  extension, not something this ADR authorizes implicitly by omission.

### 5. Concurrent ticket drafting: lock vs. documented limitation

**Decision:** documented limitation, not a lock file or sequence counter. `createTicket`
closes the most damaging failure mode (two writers silently overwriting each other's file
at the same path) with an atomic exclusive create (`open(path, "wx")`) and retries against
a freshly re-read `nextNumber` on collision, up to a bounded attempt count. It does not
serialize concurrent drafting with a lock: the local ticket buffer is meant for a human or
a small number of agents drafting tickets in the same working tree, not a
high-concurrency write path, and a lock file adds a new failure mode (a stale lock left
by a crashed process) for a problem that, empirically, is rare enough that "retry, or file
it manually" (the error `createTicket` raises after exhausting attempts) is an acceptable
answer. Revisit if concurrent drafting becomes routine rather than exceptional.

## Consequences

- `tracker` and `sync` are now two agents where there was one; `packs/core/pack.json`
  bumped to `0.3.0` to mark the contract change (a repo installing the old `tracker.md`
  behavior alongside the new sync path would risk double-creating issues, which is exactly
  the failure class this rewrite closes).
- `project.tickets` is optional with a default (`dir: "docs/tickets"`), unlike `board`
  (required since day one) — an existing `litecode.config.json` from before this feature
  continues to parse unchanged.
- A ticket file is never a place to read current pipeline state from; any tooling built
  against this buffer must go through `litecode ticket sync`'s pull step (or the board
  directly) for that, never parse a ticket file's `status` field and trust it once
  `issue` is set.
