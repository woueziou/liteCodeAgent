---
name: chained-implementation
description: Chains dispatcher→implementer into one invocation instead of two separate manual steps. Use when a human explicitly says to "chain"/"enchaîne" onto a specific ticket, or asks to run the full backlog→PR flow on a ticket in one go. Never triggers on its own — always requires an explicit human instruction naming the ticket.
---

# Chained implementation

This skill exists to remove invocation friction, not human oversight. It still requires an explicit human instruction naming a specific ticket — it must never be invoked speculatively, on a schedule, or as a reaction to a ticket simply existing in Planned/Backlog.

## When to use

The human says something like "enchaîne sur 0010", "chain dispatcher and implementer on ticket 0012", "run the full flow on 0007" — always naming a specific ticket, always as an explicit ask in the current turn.

## What you do

1. Invoke `dispatcher` (via {{> delegate dispatcher}}) scoped to the named ticket only — tell it explicitly which ticket to plan, not to run its normal full-backlog ranking pass, so it doesn't pull in unrelated items.
2. Read `dispatcher`'s output. If it reports a `CONFLICTS` entry for the named ticket (e.g. a Due Date/Priority tension it wouldn't resolve on its own), stop and surface that to the human before continuing — do not proceed past a flagged conflict without human input.
3. If the ticket was successfully moved to `Planned` (or was already there), invoke `implementer` (via {{> delegate implementer}}) on that ticket.
4. Verify `implementer`'s report before relaying it — its own account of the run is not evidence. Write its final output verbatim to a temporary file and run `litecode verify-report --file <path>` via `Bash`. That command checks the report's `STATUS`/`TICKET`/`BRANCH`/`PR`/`CHECK_OUTPUT` against the real branch, the real PR, the ticket file's `status`, and the primary checkout (for changes written outside the worktree). Do not re-derive or soften its findings yourself.
5. Relay `implementer`'s full output back to the human — including any `blocked` status, since a blocker escalated to `triage` inside `implementer` still needs the human to know about it, not just get silently absorbed — together with `verify-report`'s output, verbatim. If `verify-report` exited non-zero, lead with its errors and say plainly that the report contradicts the repo: never present that run as a success. Warnings are relayed as-is, without being upgraded or dismissed.

## Delegating

{{> delegation}}

## Hard rule

This skill is a convenience wrapper around two already-existing human-invoked steps, not a new autonomous trigger. It does not run on a timer, does not scan the ticket buffer for work to pick up on its own, and does not chain onto any ticket that wasn't explicitly named by the human in the current instruction.
