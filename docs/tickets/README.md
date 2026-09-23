# Local ticket buffer

This directory is the **sole source of truth** for pipeline state (Status, Priority,
Size). There is no GitHub Project board any more; GitHub issues only mirror a ticket's
title, body, and comments. See
[`docs/decisions/0012-local-ticket-buffer-as-sole-source-of-truth.md`](../decisions/0012-local-ticket-buffer-as-sole-source-of-truth.md)
(which supersedes the "GitHub is authoritative" framing of
[ADR 0001](../decisions/0001-local-ticket-buffer-and-github-sync.md)).

## What a ticket file is

One markdown file per ticket, named `NNNN-kebab-slug.md`, with a frontmatter block that
mirrors a GitHub issue plus a few sync-bookkeeping fields:

```markdown
---
schemaVersion: 1
id: 0001-fix-the-flaky-board-test
title: Fix the flaky board test
label: bug
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate:
issue:
synced: false
syncedAt:
---

Body goes here, exactly like a GitHub issue body.
```

- `synced: false` means this file holds a title/body change GitHub has not seen yet — it
  is a **dirty flag**, not a state to read pipeline status from. Staged comments (below)
  make a file dirty on their own.
- `issue` is empty until the first successful sync creates the GitHub issue; from then on
  it never changes.
- `status`/`priority`/`size` are **purely local**: edit them in place, by hand or by an
  agent. `litecode ticket sync` never pushes them anywhere and never overwrites them.

## Staging a comment

Wrap text in a comment block anywhere in the body; `litecode ticket sync` posts it and
removes the block from the file once it's posted:

```markdown
<!-- litecode:comment -->
This is a comment that will be posted to the issue on the next sync.
<!-- /litecode:comment -->
```

## Commands

```bash
litecode ticket new --title "..." --label bug --priority medium --size small --body "..."
litecode ticket list
litecode ticket sync            # dry run
litecode ticket sync --apply    # push creations, title/body edits, staged comments
litecode ticket doctor          # malformed / misplaced / duplicate ticket files
litecode dashboard --build      # regenerate docs/dashboard.html
```

## Never hand-edit `issue` or `syncedAt`

Those are written by `litecode ticket sync` alone. The only manual touch allowed on
`synced` is setting it to `false` after editing the title or body of a ticket that
already has an `issue`, so the next sync pushes the edit. Never set it to `true` by
hand: that makes a file lie about whether GitHub has seen its content, which is exactly
the failure mode this buffer exists to avoid.

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
