---
generated_by: implementer
task: "local-first tickets epic (lot 7/9)"
---

# 0012. Local ticket buffer as sole source of truth

Status: proposed
Date: 2026-09-21


> **Partly superseded (2026-09-23) by ADR 0015.** The local ticket file stays the sole
> source of truth, but GitHub issues are no longer a place tickets are published to:
> `sync`, `ticket sync` and the `issue`/`synced` fields are gone. The text below is the
> historical record.

## Context

The local-first tickets epic removed the GitHub Project board entirely: `src/board/`
is gone, `litecode board init`/`litecode board doctor` no longer exist, and pipeline
state (`status`, `priority`, `size`, `assignedAgent`) lives only in the local ticket
buffer under `docs/tickets/`. GitHub is still used, but only as a place to publish —
`gh issue create`/`comment`/`edit` (via `sync`), `gh issue list` (via `ticket new`'s
dedupe check), and `gh pr create`/`comment` (via `implementer`/`reviewer`) — never as
a place to read pipeline state back from.

Lot 7 of that epic marked four existing ADRs (0001, 0002, 0009, 0010) as
`Status: superseded by ADR 0012 (local-first tickets, lot 7/9 — not yet written)`,
because each of them records a decision made when a GitHub Project board still
existed and mediated pipeline state. This ADR is that document: it records what
lot 7-9 actually shipped, states plainly which parts of 0001/0002/0009/0010 it
replaces and why, and writes down — without resolving them — the questions the
epic's own audit found still open.

This document is a retroactive record, not a proposal: the nine lots it describes
are already merged on `origin/main` (`819c9cb`). It is not an ADR gate needing
approval to land — it is the write-up the project owner asked for once four other
ADRs were left pointing at nothing.

## Decision: what is settled (already implemented, recorded here rather than re-opened)

### 1. `priority`, `size`, `assignedAgent` are local-only fields, always editable

These three fields live in the ticket file's frontmatter (`src/tickets/spec.ts`) and
are edited directly by whichever agent needs to change them (`dispatcher` re-planning
Priority/Due Date, `tracker` setting an initial Size, and so on). Their original
justification under ADR 0001/0002 — "the board is the source of truth after ticket
creation, so these are pull-only past that point" — no longer applies, because there
is no board to pull from or defer to. They are simply local state now, the same as
`title`/`body`: an agent edits the file, marks it dirty, and that edit stands.

### 2. Epics are nested directories under `docs/tickets/`, explicitly ordered

A ticket lives at `docs/tickets/<epic>/<ticket-id>-<slug>.md`. As shipped on `main`
as of this writing, the five epic directories are `ticket-buffer`,
`local-first-tickets`, `pipeline-fiabilite`, `install-config`, `board-legacy` — five
epics, 29 tickets total. This replaces the earlier flat `docs/tickets/*.md` layout
ADR 0001
introduced — migrating the pre-existing flat tickets into this structure was itself
one of the epic's own lots (`0024-chore-tickets-migrer-les-20-tickets...`).

A separate, still-open PR (#59) proposes prefixing each epic directory with an
explicit `NN-` reading/execution order (`01-ticket-buffer`, `02-local-first-tickets`,
`03-pipeline-fiabilite`, `04-install-config`, `05-board-legacy`). That renaming is
proposed, not yet merged, as of this writing — this ADR records the directory
structure as it actually exists on `main` today, not the pending rename.

### 3. The dashboard builds only on explicit command, and its output is committed

`litecode dashboard --build` regenerates a standalone `docs/dashboard.html` from the
current ticket buffer. There is no server, no background process, no file watcher,
no git hook that triggers a rebuild. The generated HTML is committed to the repo —
a deliberate choice by the project owner, with the accepted consequence that the
committed file can go stale between one `--build` invocation and the next; nothing
in this repo enforces that it be rebuilt before every commit that touches
`docs/tickets/`. Anyone reading `docs/dashboard.html` is reading a snapshot, not a
live view, and the dashboard's own generated output says so (see Open question B
below, which the dashboard's code comments already point at this ADR for).

### 4. `issue:` and `synced:` are a historical push record, not state anything derives from

This was verified by code audit during lot 9, not assumed. The only readers of
`ticket.issue` and `ticket.synced`/`syncedAt` in the entire codebase are:

- `src/tickets/sync.ts`'s push logic — `ticket.issue === undefined` decides whether a
  ticket action is `create` (first `gh issue create`, which then persists the
  returned issue number back onto the ticket immediately) or `update` (`gh issue
  edit`/`gh issue comment` against the existing issue); `ticket.synced` (combined with
  whether any comments are still pending) decides whether a ticket is dirty enough to
  need a sync pass at all.
- `src/cli.ts`'s `ticket list` rendering — displays `synced`/`dirty` as a status
  column for a human reading the CLI output.

No code path reads `issue` or `synced` to derive `status`, `priority`, `size`, or
`assignedAgent`. Those four fields are set and read directly from their own
frontmatter keys; `issue`/`synced` never feed into them. This closes off a
plausible-sounding but false alternative reading of the local buffer, where
"synced" might be mistaken for meaning "authoritative" — it means only "has this
title/body/comment state already been pushed to GitHub."

## Context that did not change

- `project.board` remains in `ConfigSchema` (`src/config.ts`), `.default({...})`
  (every field defaulted, so a config predating this key still parses without
  needing to name it explicitly), purely so a `litecode.config.json` committed
  before this epic still parses without a migration step. `litecode init` no longer
  writes this key for a fresh project, and no runtime code reads any field of it any
  more — it is vestigial, kept only for backward config compatibility, not because
  any part of the pipeline still consults it.
- `gh issue create`/`comment`/`edit` (via `sync`), `gh issue list` (via `ticket new`'s
  dedupe check — `src/tickets/dedupe.ts`'s `fetchOpenIssueDedupeCandidates`, called from
  `cmdTicket`'s `sub === "new"` branch in `src/cli.ts`, not from `sync`), and
  `gh pr create`/`comment` (via `implementer`/`reviewer`) are the only GitHub surfaces
  this project still calls. Every board-specific *code path* — `gh project item-add`/`item-edit`, the whole
  `src/board/` module — is gone; nothing in the runtime issues those calls or
  imports that module any more. The two data files those calls used to write,
  `.claude/data/board.json` and the item-id cache
  (`.claude/data/github-project-item-ids.json`), are still git-tracked in the repo
  as of this writing — stale, unreferenced by any code, and not cleaned up by this
  epic. Removing them is a leftover cleanup, not a decision this ADR makes.

## Consequences

- **Public contract break.** `litecode board init` and `litecode board doctor` no
  longer exist as commands. Any script, CI job, or onboarding doc that invoked them
  directly breaks. The commit that actually removes them (`f8941d9`,
  `feat(tickets)!: supprimer src/board/...`, carrying its own `BREAKING CHANGE:`
  footer) is not yet released as of this writing — `package.json` is still `0.14.0`
  with further unreleased commits on top, and `f8941d9` postdates the `v0.14.0` tag.
  Under this project's semantic-release/Angular-convention tagging, a `feat!:`/
  `BREAKING CHANGE:` commit drives a major version bump once it does ship — so this
  should land as a 1.0.0, not another `0.x.0` minor.
- **`project.board` is now dead weight in the schema**, kept solely for old-config
  compatibility (see above) — a maintenance note for anyone tempted to "clean up" the
  schema: removing it outright would break parsing of configs written before this
  epic, which is a worse cost than carrying a few unused fields.
- **The dashboard can go stale.** Because it only regenerates on explicit command and
  its output is committed, `docs/dashboard.html` is a point-in-time snapshot that can
  silently drift from `docs/tickets/`'s actual current state. This is an accepted
  cost of the "no watcher, no server" decision above, not an oversight — but it is
  the concrete cause of open question B below.
- **Board-mediated coordination is gone entirely.** There is no longer a shared,
  live, human-editable view of pipeline state outside the repo itself; `docs/tickets/`
  and its generated dashboard are it. This trades away whatever the GitHub Project UI
  offered (drag-and-drop status moves, a board view external tools could poll) for the
  rate-limit and coupling problems ADR 0001 originally set out to solve.

## ADRs this supersedes

- **ADR 0001** ("Local ticket buffer and GitHub sync") — its "Status/Priority/Size are
  pushed to the board exactly once, then pull-only" decision assumed a board existed
  to pull from. That board is gone; Decision 1 above (`priority`/`size`/`assignedAgent`
  are now plain local fields) and ADR 0010 (Status becomes push-on-update through
  `sync`, itself already superseded onward by this document once the board it pushed
  *to* was removed) together replace it. ADR 0001's `schemaVersion` policy and
  `gh`-call throttling decisions are unaffected by this ADR and remain in force.
- **ADR 0002** ("Reject derived project fields in board planning") — this entire
  decision concerned `planBoard`'s handling of GitHub Project field shapes
  (`isIssueField`, `DERIVED_DATATYPES`). `src/board/` no longer exists, so there is no
  `planBoard` for this to apply to. Superseded outright, with no replacement — the
  problem class it addressed (board field collisions) cannot occur without a board.
- **ADR 0009** ("Unattended `ticket sync --auto`: trigger, conflict handling,
  anti-runaway") — its trigger/cooldown/trace-file mechanics (the `--auto` flag,
  `autoStateFile`, `autoMinIntervalMs`) are untouched by the board's removal and
  remain in force exactly as written; what's superseded is only its framing of
  `sync`'s role as pushing *to* a board pull step also reads from. Decision 4 above
  (`issue`/`synced` as a push-only record, not board-mirroring state) is the
  up-to-date description of what `sync` is actually keeping in sync.
- **ADR 0010** ("Agent-initiated Status push through `sync`") — its central move,
  routing every GitHub Project mutation exclusively through `sync`, is moot once
  there is no GitHub Project to mutate; `sync` today only ever calls `gh issue
  create`/`edit`/`comment`. Decision 1 above (`status`, like `priority`/`size`
  /`assignedAgent`, is now a plain local field any agent edits directly) is what
  replaces the Status-specific push mechanism ADR 0010 built.

## Open questions (not decided by this ADR — owner arbitration needed)

### A. Who transitions a ticket from `readyToMerge` to `done` after its PR merges?

Confirmed gap: nothing in the pipeline currently references the merge event. The
`implementer`/`reviewer` flow ends at a `reviewer` verdict (landing the ticket on
`readyToMerge`); nothing after `gh pr merge` writes `status: done` back onto the
ticket file. In practice, tickets 0021, 0022, and 0023 all had to be moved to `done`
by hand.

Options the epic's audit surfaced, none chosen here:

- A step added to `sync` (or to whichever agent performs the merge) that writes
  `status: done` when `gh pr view <n> --json state` reports `MERGED` — but this
  requires a ticket↔PR link that does not exist today; the frontmatter only carries
  `issue:` (the GitHub issue number), never a PR number or URL.
- A manual `litecode ticket close <id>` command, run by hand or as a deliberate last
  step of the pipeline.
- A GitHub webhook or Action firing on merge — explicitly noted as reintroducing the
  network coupling this epic removed, and therefore in tension with its own premise.

### B. Where does transition history come from?

The frontmatter keeps no dated log of status changes — only the current value. The
lot 8 dashboard therefore renders a point-in-time snapshot, not a timeline, and its
own generated code says so, pointing here. Options: a transition log appended to the
frontmatter itself, a separate events file, or a derivation from git history on
`docs/tickets/`.

**Dependency between A and B:** whatever mechanism eventually closes question A would
itself produce the dated, structured event that question B is currently missing (a
merge event, with a timestamp, written by an automated step rather than a human's
manual edit). The owner should weigh these together rather than resolve them
independently — a solution to A designed without B in mind could easily produce an
event shape B can't reuse, and vice versa.

### C. `PRIORITY_OPTIONS`/`SIZE_OPTIONS` never actually moved

The epic's plan for lot 2 described relocating `PRIORITY_OPTIONS` and `SIZE_OPTIONS`
out of `src/board/spec.ts`. Neither symbol exists anywhere in the repository today;
`src/tickets/spec.ts` instead defines `PRIORITIES`/`SIZES` tuples and `Priority`/
`Size` types. This has no functional effect — Zod validation against those tuples
works correctly — and is plausibly just a sound renaming once "board options" no
longer meant anything without a board. Left here as a named discrepancy between the
plan and what shipped, to be acted on or explicitly waved off by the owner, not
silently left unexplained.
