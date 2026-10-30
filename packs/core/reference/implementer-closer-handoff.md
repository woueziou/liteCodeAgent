---
name: implementer-closer-handoff
description: Reference for implementer (not a skill; read on demand when the case arises).
install: handoff
---

# Handing the tail of the run to `closer` (implementer)

Loaded by `implementer` at step 8 when the handoff is on (ADR 0027). `closer` waits for CI, runs and posts both reviews, sets the ticket status and writes its note; it never touches code. You keep the code, the disputes and the final report. Subagent nesting at depth 3 is seen in this project's transcripts; the chain implementer to closer to reviewer is verified only by the measurement of ADR 0027, so the capability table stays empty until then.

## Starting it

Start `closer` with {{> delegate closer}}, like the reviews. It waits for its own reviews inside its turn, so its result is the block below, never a status sentence: treat any reply that is not the result block as not finished, do not start a second `closer`, and let the notification (or the call) bring the result.

## Before delegating

The journal says `step 7: PR opened`. Write a ticket note ending in a `progress-journal` block (`implementer-progress-journal`) with `step: step 8: closer in flight`, `handoff: closer in flight` and `handoffAt: <now, ISO 8601 UTC>` **before** you start `closer`: while that marker is under two hours old, `litecode resume` refuses to start a second writer on the worktree.

The brief is the one `closer`'s page describes under "The brief": send exactly those fields, with `attempt` 1 and `rehunts_used` 0.

## When it returns

Write `handoff: returned` and a fresh `handoffAt` in the same block format: the closer never writes the journal. If the call errors out or ends without its result block, write `handoff: returned` with a note of the failure, then do the tail yourself as for `nesting-unavailable`. Commit the ticket files `closer` changed (it never commits). Re-read the ticket file: its `status` must equal `TICKET_STATUS` (`unchanged`: the status you launched it with). Then act on `NEEDS`; `implementer-closer-outcome` holds the counters and the final report.

- `none`: the final report.
- `code-fix:ci-red` or `code-fix:review`: the fix loop. Read the ticket's `status` first and move it `review` to `inProgress` only if it is `review` (the rule of `implementer-resume`), before touching code. After `code-fix:ci-red` the closer stopped before step 4 with `TICKET_STATUS: unchanged`, so the ticket is still `inProgress`: no move. Fix (`implementer-ci-red`, `implementer-rehunt`), re-run `{{ project.checkCommand }}`, push, write `closer in flight` again and start a new `closer` with `attempt` plus one and the updated counters. At most **two relaunches**: if the third answer is still not `none`, stop as you would in-line: ticket `review`, note with the findings, final report. A finding that looks false, or asks for a history rewrite, is yours to dispute (`implementer-review-disputes`), never the closer's.
- `conflict` or `github-unavailable`: no loop. Ticket `review` with a note naming the evidence, then the final report; for a GitHub outage Read `implementer-github-outage`.
- `nesting-unavailable`: do the tail yourself, exactly as in-line: Read `implementer-inline-tail` and perform its steps 8 to 10.

Never send a report while a `closer` you started has not returned.
