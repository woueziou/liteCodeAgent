---
generated_by: claude
task: "0030"
---

# 0015. Tickets are purely local: no GitHub issues, pull requests only

Status: proposed
Date: 2026-09-23

## Context

ADR 0012 made the local ticket file the sole source of truth for pipeline state, but kept
GitHub issues as a place to publish tickets: the `sync` agent ran `litecode ticket sync`
to create an issue per ticket and push title/body edits, and agents staged comments in
`<!-- litecode:comment -->` blocks until `sync` posted them. That left a second copy of
every ticket to keep consistent, a `synced` dirty flag to reason about, a `gh issue list`
call in `ticket new`'s duplicate check, the `issue:` number as a ticket's identity in
prompts ("Closes #n", `gh issue view <n>`), and an invariant ("only `sync` talks to gh")
that could only be checked in prompts, never enforced (ticket 0016).

The project owner decided on 2026-09-23 to drop GitHub issues entirely and keep pull
requests (ticket 0030).

## Decision

1. **A ticket is its file.** There is no GitHub issue behind it. A ticket is identified by
   its id (`NNNN-slug`) or its number, never by an issue number.
2. **Ticket schema v2.** `issue`, `synced` and `syncedAt` are removed from the
   frontmatter. A note on a ticket is plain text appended to its body under a dated
   heading (`### <YYYY-MM-DD> — <agent>: <what>`), not a staged comment. v1 files still
   parse — the stale keys are ignored — and `litecode ticket migrate [--apply]` rewrites
   them as v2, turning each staged comment into plain text so none is lost.
   `ticket doctor` warns about v1 files until then.
3. **Removed:** `litecode ticket sync` (and `--auto`), the `sync` agent, the auto-sync
   state file and its config keys, and `ticket new`'s GitHub issue lookup. The duplicate
   check compares against local tickets only.
4. **Pull requests stay.** `implementer` opens one per ticket with `gh pr create`, names
   the ticket in its body instead of "Closes #n", and posts `reviewer` and `bug-hunter`
   verdicts on it. `verify-report` reads a `TICKET:` field (still accepting `ISSUE:` from
   older installed prompts) and finds the ticket file by id.
5. **A pack test forbids the old vocabulary** — `gh issue`, `ticket sync`, staged
   comments, `synced`, `issue: <n>` lookups and "Closes #" — in every pack file.

This supersedes the GitHub-publishing parts of ADR 0001 and ADR 0012, all of ADR 0009
(the unattended sync trigger), and ADR 0010's residue. Ticket 0016 is obsolete.

## Consequences

- **Breaking change for CLI users**: `litecode ticket sync` no longer exists, and ticket
  files move to schema v2. Configs that still carry `tickets.autoStateFile` or
  `tickets.autoMinIntervalMs` keep parsing; the keys are ignored.
- GitHub's secondary rate limit, which motivated the batched `sync`, no longer applies to
  tickets: the pipeline's only `gh` calls are the pull-request ones.
- Existing GitHub issues are left as they are. The link between a migrated ticket and its
  old issue number survives only in that ticket's git history.
- Ticket notes and status edits are ordinary file edits, made by every agent in the main
  checkout's copy of the ticket so the next agent, the dashboard and `ticket list` see
  them immediately. No agent commits a ticket file; the human does, like any other change.
  Until then they are uncommitted work — a `git stash` or `git checkout -- docs/tickets`
  discards them, including an ADR draft's resume manifest. Committing them on the ticket's
  branch instead was tried and rejected: the default branch then showed stale statuses,
  `triage` and `dispatcher` couldn't see a blocker, and a verification-only ticket's `done`
  never left its unmerged branch.
- A report from a prompt installed before this change names a GitHub issue
  (`ISSUE: #45`); `verify-report` says so explicitly and skips the ticket-status check
  rather than guessing which ticket it meant.
