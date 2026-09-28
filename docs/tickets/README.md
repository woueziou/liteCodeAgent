# Tickets

This directory **is** the ticket tracker: one markdown file per ticket, and nothing else.
There is no GitHub issue behind a ticket (see
[`docs/decisions/0015-tickets-are-purely-local.md`](../decisions/0015-tickets-are-purely-local.md));
the only GitHub artefact of the pipeline is the pull request that implements a ticket.

## What a ticket file is

A file named `NNNN-kebab-slug.md`, inside an epic directory, with this frontmatter:

```markdown
---
schemaVersion: 2
id: 0031-fix-the-flaky-install-test
title: Fix the flaky install test
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate:
importedFrom:
---

## Contexte
Why this is being done.

## Critères d'acceptation
The concrete, checkable conditions that mean this is done.

## Plan
The ordered implementation steps.

## Hors périmètre
What this ticket deliberately does not cover, or "n/a".
```

- `status`, `priority`, `size` and `assignedAgent` are edited in place, by hand or by an
  agent. `dispatcher`, `implementer` and `triage` move a ticket through
  `backlog` → `planned` → `inProgress` → `review` / `readyToMerge` → `done` (or `blocked`)
  by writing `status`.
- `id` never changes once the file exists.
- `importedFrom` is empty for a ticket drafted normally. It's set once, and only by
  `litecode ticket import-board` (ticket 0050, ADR 0019) — a one-time exit for a project
  still on the old GitHub Project v2 board (see
  [`docs/decisions/0015-tickets-are-purely-local.md`](../decisions/0015-tickets-are-purely-local.md)),
  not a live sync. `github:owner/repo#123` for a ticket imported from an issue-backed item,
  `github-project-item:<id>` for one imported from a draft item with no issue. Never
  removed once written: it's the exact string `import-board` compares against to skip an
  item it already imported, so re-running the command after an interruption resumes rather
  than re-importing or overwriting anything.

## The body contract (ticket 0035)

A ticket's body is structured, not free text: `## Contexte`, `## Critères d'acceptation`,
`## Plan`, `## Hors périmètre`, in that order, every time. `tracker` writes a freshly
drafted ticket with exactly these four sections and, when it was handed `orchestrator`'s
output, recopies `orchestrator`'s `PLAN` and the synthesized requirements **verbatim**
into `## Plan` and `## Critères d'acceptation` — the debated plan doesn't get lost or
paraphrased on its way into the ticket file. Section names are load-bearing: `ticket
doctor` looks for `## Critères d'acceptation` by that exact heading, and ticket 0036
(reviewer checking each acceptance criterion) is planned to look for `## Critères
d'acceptation` and `## Plan` the same way — renaming a heading here is a breaking change
to that contract, not a cosmetic edit.

`litecode ticket doctor` warns about any `planned`/`inProgress` ticket whose `##
Critères d'acceptation` section is missing or empty — a ticket that's active without
acceptance criteria is something `implementer` can't safely work from.

### The `[À CLARIFIER]` marker

`[À CLARIFIER]` (Spec Kit's `[NEEDS CLARIFICATION]`, in this project's language) marks an
open question inside a ticket body that a human still needs to resolve. While that marker
is present anywhere in the body, `litecode ticket move <id> planned` refuses the move —
the same command `dispatcher` and `triage` both use to advance a ticket out of `backlog`
or `blocked`, so the gate applies no matter which of them tries it. Resolve the question
and remove the marker (typically via `triage`, or a human editing the ticket directly)
before the ticket can be planned.

The marker literal is a single exported constant
(`CLARIFICATION_MARKER` in `src/tickets/spec.ts`) — a project wanting a different marker
changes it there.

## Notes on a ticket

The body keeps the ticket's history. An agent (or a human) adds to it by appending a dated
note at the end, never by rewriting what's already there:

```markdown
### 2026-09-23 — implementer: PR opened

https://github.com/owner/repo/pull/67 — reviewer: approve, bug-hunter: HUNT complete.
```

## Commands

```bash
litecode ticket new --title "..." --label bug --priority medium --size small --body "..."
litecode ticket list                # status, id, priority/size
litecode ticket doctor              # malformed / misplaced / duplicate / outdated files
litecode ticket migrate [--apply]   # rewrite schema-v1 files as v2
litecode ticket import-board [--apply]  # one-time import of GitHub Project board items (ADR 0019)
litecode dashboard --build          # regenerate docs/dashboard.html
```

`ticket new` refuses a title that reads like an existing ticket's; pass `--force` when it
really is different work.

## Migration note — schema v2 on 2026-09-23

Schema v1 tickets mirrored a GitHub issue: they carried `issue`, `synced` and `syncedAt`
in the frontmatter, and staged comments in `<!-- litecode:comment -->` blocks until the
`sync` agent posted them. `litecode ticket migrate --apply` rewrote every ticket here as
v2: the three keys are gone, and each staged comment became plain text in the body, so
none was lost. The GitHub issue a v1 ticket was linked to is still visible in that
ticket's git history.

## Migration note — flat layout retired on 2026-09-21

As of 2026-09-21, ticket files moved from a flat `docs/tickets/NNNN-slug.md` layout into
per-epic directories: `docs/tickets/<epic>/NNNN-slug.md`. Epic directories carry an
explicit order prefix: `01-ticket-buffer`, `02-local-first-tickets`,
`03-pipeline-fiabilite`, `04-install-config`, `05-board-legacy`. The filename
itself did not change, only its parent directory. `ticketFiles` walks the tree
recursively and handles both layouts, so no code change was required to read migrated
files.

This is a **deliberate, dated cutoff, not a silent move**: any reference to the old flat
path — inside an ADR's prose, a ticket body, or a GitHub PR comment already posted before
this date — now points at a location that no longer exists. References inside this repo
(ADRs, other ticket bodies) can in principle be fixed going forward; nothing under
`docs/decisions/0008`-`0011` needed changing at migration time (they refer to tickets by
number/issue, not by literal flat path). References inside already-published GitHub PR
comments are external and were **not** and cannot be edited — treat any flat
`docs/tickets/NNNN-*.md` link found in a PR comment dated before 2026-09-21 as broken.
