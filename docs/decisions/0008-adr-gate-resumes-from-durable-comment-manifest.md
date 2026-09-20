---
generated_by: implementer
task: "#28"
---

# 0008. The ADR draft approval gate resumes from a durable comment manifest, not session memory

Status: proposed
Date: 2026-09-19

## Context

`implementer`'s ADR draft approval gate stops the run after posting a drafted ADR as an
issue comment, and step 5 of that gate previously said: "If you're resumed specifically to
continue past this gate, treat the human's message as that approval." That sentence assumes
a resume that actually works.

In practice it doesn't. The underlying agent process and its transcript are ephemeral —
three same-class occurrences (issues #10, #17, and #29, the last happening the day this
ticket was filed) show the resume attempt failing with `could not be resumed: No transcript
found for agent ID: <id>`. Every time, the calling (human-facing) session had to relaunch a
fresh `implementer` and manually reconstruct seven pieces of state from whatever it still
had in its own context: worktree path, branch name, commit sha, the ADR file's path (which
is untracked on disk at that point), the board's current status, which checks had already
passed, and — critically — that the ADR had already been posted as a comment and must not be
posted again. That reconstruction is fragile by construction: it depends on the calling
session still holding all seven facts in its own context at the moment of approval, and
omitting even one (most often "don't repost the ADR") produces a duplicate action rather
than a clean resume. This is the same class of problem as the ticket-buffer's earlier
duplicate-issue-creation bug: state that only exists in memory is state that gets replayed
wrong.

The root cause — why the harness can't resume the same agent/transcript — is out of scope
for this ADR; it is plausibly a harness/session-lifecycle property, not something fixable in
this repo's prompts. What is fixable here is making that resume unnecessary: write the state
the gate needs somewhere durable at the moment the gate fires, so a completely fresh
`implementer` invocation can reconstruct correctly from that artifact instead of from a
human or calling session's memory.

## Decision: the state carrier is the same ADR-draft comment already being posted, via a fenced `resume-manifest` block

When `implementer` posts the drafted ADR as an issue comment (gate step 2), it now appends a
fenced ` ```resume-manifest ``` ` block to the *same* comment, containing: `worktree`,
`branch`, `commit` (or `none`), `adr_path`, `board_status`, `checks_passed`, and
`adr_posted: true`. Gate step 5 is rewritten so that resuming — by default assumed to be a
freshly invoked `implementer` with no memory of the prior run, not a same-process resume —
fetches that comment, reads the manifest, and reconstructs mechanically: reuse the worktree
if present or recreate it by checking out the existing branch (never `-b` a new one),
verify each field against actual repo state (confirm the commit is in `git log`, the ADR
file exists and matches, re-run the check command rather than trusting `checks_passed`
blindly), and treat `adr_posted: true` as an idempotency guard against ever re-posting the
ADR comment.

**Alternative considered and rejected: a separate state file committed to the branch.**
Rejected because it would have to be committed to be durable, but the ADR file itself is
deliberately *not* committed yet at this point in the flow (that's the entire point of the
gate — nothing lands until a human approves) — so a same-commit manifest file would either
have to go in an already-dirty working tree that isn't pushed anywhere durable, or force an
early, premature commit just to persist bookkeeping. The issue comment is already the
artifact the flow posts regardless, is already durable and human-visible, and needs no extra
push/commit choreography.

**Alternative considered and rejected: a manifest in the local ticket buffer file only,
never posted to GitHub.** Rejected for tickets that don't have a local ticket file
(`{{ project.tickets.dir }}` per-ticket file is optional — some older/directly-filed issues
have none), and because the local buffer only reaches GitHub on `sync`'s batched runs, not
immediately — the same lag the comment itself is already subject to. Piggybacking on the
comment that's posted either way (staged-then-synced, or posted directly) covers both cases
with one mechanism instead of two.

**Alternative considered and rejected: promising a working same-process resume.** Rejected
per the ticket's explicit scoping — the harness's transcript lifecycle is not something this
repo's agent prompts can fix, and promising it would just recreate the same failure the
third occurrence (#29) already demonstrated.

## Consequence

A human approving an ADR no longer needs to hold worktree/branch/commit/ADR-path/"already
posted" state in their own head or in a calling session's context across the approval gap.
Whichever `implementer` invocation picks the ticket back up — resumed or entirely fresh —
reads the same seven facts from the same durable comment, verifies rather than trusts them,
and proceeds idempotently. The cost is a slightly larger ADR-draft comment (one fenced block
appended) and a slightly longer step 5 in `implementer.md`; both are small relative to a
duplicate-ADR-comment or a mis-reconstructed branch/worktree, per the "not previously
committed" precedent this ADR shares with the ticket-buffer dedupe fix.
