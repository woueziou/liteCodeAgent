---
name: chained-implementation
description: Chains dispatcher→implementer into one invocation instead of two separate manual steps. Use when a human explicitly says to "chain"/"enchaîne" onto a specific issue, or asks to run the full backlog→PR flow on a ticket in one go. Never triggers on its own — always requires an explicit human instruction naming the issue.
---

# Chained implementation

This skill exists to remove invocation friction, not human oversight. It still requires an explicit human instruction naming a specific issue — it must never be invoked speculatively, on a schedule, or as a reaction to a ticket simply existing in Planned/Backlog.

## When to use

The human says something like "enchaîne sur #10", "chain dispatcher and implementer on issue #12", "run the full flow on #7" — always naming a specific issue, always as an explicit ask in the current turn.

## What you do

1. Invoke `dispatcher` (via `Agent`, subagent_type `dispatcher`) scoped to the named issue only — tell it explicitly which issue to plan, not to run its normal full-backlog ranking pass, so it doesn't pull in unrelated items.
2. Read `dispatcher`'s output. If it reports a `CONFLICTS` entry for the named issue (e.g. a Due Date/Priority tension it wouldn't resolve on its own), stop and surface that to the human before continuing — do not proceed past a flagged conflict without human input.
3. If the issue was successfully moved to `Planned` (or was already there), invoke `implementer` (via `Agent`, subagent_type `implementer`) on that issue number.
4. Relay `implementer`'s full output back to the human — including any `blocked` status, since a blocker escalated to `triage` inside `implementer` still needs the human to know about it, not just get silently absorbed.

## Hard rule

This skill is a convenience wrapper around two already-existing human-invoked steps, not a new autonomous trigger. It does not run on a timer, does not scan the board for work to pick up on its own, and does not chain onto any issue that wasn't explicitly named by the human in the current instruction.
