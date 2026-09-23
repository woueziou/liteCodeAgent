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
---

What needs doing, and why — enough for `implementer` to work from without asking.
```

- `status`, `priority`, `size` and `assignedAgent` are edited in place, by hand or by an
  agent. `dispatcher`, `implementer` and `triage` move a ticket through
  `backlog` → `planned` → `inProgress` → `review` / `readyToMerge` → `done` (or `blocked`)
  by writing `status`.
- `id` never changes once the file exists.

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
