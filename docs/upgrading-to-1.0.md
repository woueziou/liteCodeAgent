# Upgrading to 1.0

1.0 changes three things that affect an existing install: the GitHub Project board is
gone, tickets no longer mirror GitHub issues, and pack prompts name no harness's
delegation tool directly. The steps below take a project on 0.x to 1.0. They are safe to
re-run.

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
  `migrate` stop and name it. Move that information into the body, or re-run with
  `--force` to drop the key.
- Then commit the migrated tickets.

Existing GitHub issues are left as they are. A migrated ticket's old issue number stays
in its git history.

## 4. Adjust how you work with tickets

- `litecode ticket sync` is gone: there is nothing to push.
- Agents write a ticket's `status` and dated notes in the main checkout's copy, and never
  commit ticket files. **You commit them**, like any other change. Until you do, a
  `git stash` or `git checkout -- docs/tickets` discards them.
- `implementer` names its ticket in the pull request (`Ticket: <NNNN-slug>`) instead of
  "Closes #n", and reports `TICKET:` instead of `ISSUE:`. `litecode verify-report` still
  reads `ISSUE:` from agents installed before 1.0, but can't check their ticket status.

## 5. Optional clean-up

- Remove `project.tickets.autoStateFile` and `project.tickets.autoMinIntervalMs` from
  `litecode.config.json`. They're ignored now.
- `project.board` is also ignored. `litecode board init` and `board doctor` were removed
  (ADR 0012). The files they wrote, `.claude/data/board.json` and
  `.claude/data/github-project-item-ids.json`, can be deleted.

## If you maintain your own pack files

Pack prompts used to write Claude Code's vocabulary ("via `Agent`, subagent_type X"),
and install rewrote the word `Agent` for other targets. That rewrite is gone (ADR 0014).
Write a delegation as `{{> delegate X}}`, and add a `{{> delegation}}` section to any
agent or skill that delegates. Install fails if `X` isn't an agent provided by an
installed pack.
