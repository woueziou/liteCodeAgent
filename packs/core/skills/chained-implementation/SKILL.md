---
name: chained-implementation
description: Chains dispatcher then implementer on one ticket or a batch in a single run. Only on explicit human instruction.
---

# Chained implementation

This skill exists to remove invocation friction, not human oversight. It still requires an explicit human instruction naming a specific ticket — it must never be invoked speculatively, on a schedule, or as a reaction to a ticket simply existing in Planned/Backlog.

## When to use

The human says something like "enchaîne sur 0010", "chain dispatcher and implementer on ticket 0012", "run the full flow on 0007" — always naming a specific ticket, always as an explicit ask in the current turn.

## What you do

1. Invoke `dispatcher` (via {{> delegate dispatcher}}) scoped to the named ticket only — tell it explicitly which ticket to plan, not to run its normal full-backlog ranking pass, so it doesn't pull in unrelated items.
2. Read `dispatcher`'s output. If its `BATCHES` line is not `none` and groups the named ticket with others, tell the human and offer to run that group as one batch (see "Running a batch") instead of one ticket at a time; wait for their answer. If it reports a `CONFLICTS` entry for the named ticket (e.g. a Due Date/Priority tension it wouldn't resolve on its own), stop and surface that to the human before continuing — do not proceed past a flagged conflict without human input.
3. If the ticket was successfully moved to `Planned` (or was already there), invoke `implementer` (via {{> delegate implementer}}) on that ticket. {{> delegateImplementerIsolation}} Pass only the ticket id and the specifics of this launch (e.g. "no isolation, worktree at X from origin/main", "the ticket requires an ADR, number N", "a sibling ticket runs in parallel"). Do not restate what `implementer` already carries: the worktree and branch rules, committing ticket files on the default branch, waiting for CI, no forced push, the review passes, one final report. Repeating them only costs tokens and risks contradicting the agent's own page.
4. Verify `implementer`'s report before relaying it — its own account of the run is not evidence. Write its final output verbatim to a temporary file and run `litecode verify-report --file <path>` via `Bash`. That command checks the report's `STATUS`/`TICKET`/`BRANCH`/`PR`/`CHECK_OUTPUT` against the real branch, the real PR, the ticket file's `status`, and the primary checkout (for changes written outside the worktree). Do not re-derive or soften its findings yourself.
5. Relay `implementer`'s full output back to the human — including any `blocked` status, since a blocker escalated to `triage` inside `implementer` still needs the human to know about it, not just get silently absorbed — together with `verify-report`'s output, verbatim. If `verify-report` exited non-zero, lead with its errors and say plainly that the report contradicts the repo: never present that run as a success. Warnings are relayed as-is, without being upgraded or dismissed.
6. If `implementer` returns no final report, or only a background-launch acknowledgement, read {{> reference chained-implementation-no-report}} and follow it. Never fabricate a report.

## Running a batch

If the human names several tickets as one batch (for example "enchaîne le lot 0044, 0058, 0060"), run step 1 for each ticket, then invoke `implementer` once (step 3) with all the ids and the words "batch": it reads `implementer-batch`. Refuse a batch of more than 4 tickets or one containing a ticket that is not `small`. Step 4 runs `verify-report` on the report of each ticket (the batch report has one block per ticket, all sharing the branch and PR). Relay the reports as in step 5.

## Delegating

{{> delegation}}

## Hard rule

This skill is a convenience wrapper around two already-existing human-invoked steps, not a new autonomous trigger. It does not run on a timer, does not scan the ticket buffer for work to pick up on its own, and does not chain onto any ticket that wasn't explicitly named by the human in the current instruction.
