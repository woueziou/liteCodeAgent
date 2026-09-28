# Upgrading to 1.0

1.0 changes three things that affect an existing install: the GitHub Project board is
gone, tickets no longer mirror GitHub issues, and pack prompts name no harness's
delegation tool directly.

## The short version

```bash
bunx litecodeagent@latest upgrade
```

It shows its plan, asks for confirmation, and does steps 1 to 3 and 5 below in one go:
- re-renders the agents;
- deletes the orphaned `sync` agent and `github-project-sync` skill copies, when you haven't
  edited them;
- migrates your tickets;
- removes the obsolete settings, including `github-project-sync` from `agentSkills`, and
  the board's data files;
- if `project.board.number` is still configured, points you at step 3.5 below — it never
  imports on its own.

Anything it leaves alone (an edited file, a ticket with an unknown frontmatter key) is
listed with the reason. Then commit the result and read step 4, which changes how you
work.

The rest of this page describes each step, for when you want to do them by hand or check
what `upgrade` did.

The commands below use `bunx litecodeagent@latest`, which always runs the latest release.
With a global install (`litecode` on your PATH), update it first and write `litecode`
instead.

## 1–2. Update and re-render the installed agents

```bash
bunx litecodeagent@latest install            # dry run: shows what changes
bunx litecodeagent@latest install --apply
```

The `sync` agent no longer exists. `install` reports its installed copies as **orphans**
(for example `.claude/agents/sync.md`, `.kilo/agents/sync.md`) and leaves them on disk,
because files it no longer produces are never deleted silently. Remove them yourself.

## 3. Migrate your tickets

Tickets are now purely local files (ADR 0015). Schema v1 tickets carried `issue`,
`synced` and `syncedAt`, and kept unposted comments in `<!-- litecode:comment -->` blocks.

```bash
bunx litecodeagent@latest ticket doctor            # lists v1 tickets
bunx litecodeagent@latest ticket migrate           # dry run
bunx litecodeagent@latest ticket migrate --apply
```

- Every staged comment becomes plain text in the ticket body. Nothing is lost.
- A ticket carrying a frontmatter key 1.0 doesn't know (a hand-added `epic:`, say) makes
  `migrate` stop and name it, since this migration can misread a value that isn't a plain
  scalar. Confirm it's a plain scalar by hand, then re-run with `--force` to migrate it,
  keeping the key as written.
- Then commit the migrated tickets.

Existing GitHub issues are left as they are. A migrated ticket's old issue number stays
in its git history.

## 3.5. Import items still only on the board (if you used it)

If you were still on the old GitHub Project v2 board — items and issues with no local
ticket file for them yet — this is the one-time move that gets them into the local buffer
before you drop the board for good. Not a sync: run it, commit the result, then stop using
the board. Requires `project.board.number` still configured; see ADR 0019.

```bash
bunx litecodeagent@latest ticket import-board            # dry run
bunx litecodeagent@latest ticket import-board --apply
```

- Every board item (draft or issue-backed) becomes at most one ticket. Re-running is safe:
  an item already imported (same `importedFrom`) is skipped, so an interrupted run resumes
  where it left off.
- A status/priority/size value the local enums don't know about lands the ticket in
  `backlog` with an `[À CLARIFIER]` note citing the original value, which blocks planning it
  until a human resolves it.
- An issue body that doesn't already split into the four contract sections (0035) is kept
  in full under "Contexte"; the other three sections get an `[À CLARIFIER]` placeholder.
- The command prints a final tally of imported/skipped/failed items, with the reason for
  each failure — one item failing never stops the rest.
- Then commit the imported tickets, and remove `project.board` from your config
  (see step 5).

## 4. Adjust how you work with tickets

- `litecode ticket sync` is gone: there is nothing to push.
- Agents write a ticket's `status` and dated notes, and now commit those ticket files
  themselves as they go (PR #77) — not just the main checkout's copy left dirty for a human
  to commit separately. A ticket-only commit is the one standing exception to "an agent
  never commits on the default branch."
- `implementer` names its ticket in the pull request (`Ticket: <NNNN-slug>`) instead of
  "Closes #n", and reports `TICKET:` instead of `ISSUE:`. `litecode verify-report` still
  reads `ISSUE:` from agents installed before 1.0, but can't check their ticket status.

## 5. Optional clean-up

- Remove `project.tickets.autoStateFile` and `project.tickets.autoMinIntervalMs` from
  `litecode.config.json`. They're ignored now.
- `project.board` is also ignored by everything except `ticket import-board` (step 3.5).
  `litecode board init` and `board doctor` were removed (ADR 0012). Once you've imported
  what you need from the board, remove `project.board` from your config and delete the
  files it wrote, `.claude/data/board.json` and
  `.claude/data/github-project-item-ids.json`.

## If you maintain your own pack files

Pack prompts used to write Claude Code's vocabulary ("via `Agent`, subagent_type X"),
and install rewrote the word `Agent` for other targets. That rewrite is gone (ADR 0014).
Write a delegation as `{{> delegate X}}`, and add a `{{> delegation}}` section to any
agent or skill that delegates. Install fails if `X` isn't an agent provided by an
installed pack.
