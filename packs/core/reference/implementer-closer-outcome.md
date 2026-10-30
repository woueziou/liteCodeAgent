---
name: implementer-closer-outcome
description: Reference for implementer (not a skill; read on demand when the case arises).
install: handoff
---

# What to do with the closer's answer (implementer)

Loaded by `implementer` when `closer` returns (`implementer-closer-handoff`, ADR 0027): the counters it keeps, then the final report.

## Counters

The base rules, kept with the brief's `attempt` and `rehunts_used`. `attempt` is 1 on the first launch and 1 more per relaunch. One re-hunt per run: after you fix a blocking `bug-hunter` finding, relaunch with `rehunts_used` 1; that launch's hunt is the re-hunt. If it returns a blocking finding again (a second blocking finding, `rehunts_used` already 1), do not relaunch: ticket `review`, note with both reports, final report. A second `reviewer` pass is the dispute's (`implementer-review-disputes`), run by you, or the one a relaunch runs after a fix. A small ticket re-hunts only on a blocking finding. Both limits hold together: at most two relaunches.

## The final report

One report from the `closer` block, in the usual format; `litecode verify-report` checks the ticket's status against `STATUS`. `TICKET` and `BRANCH` are yours; `PR` is the PR's URL; `CI` is the block's, as returned; `CHECK_OUTPUT` is your last local run, re-run after the last fix; `TOKENS` is yours plus every closer's.

| `NEEDS` (last answer) | Ticket you leave | `STATUS` | `BLOCKER` |
| --- | --- | --- | --- |
| `none` | `readyToMerge` or `review` | `pr-opened-for-review` | `none` |
| `code-fix:ci-red`, `code-fix:review` after the limit, or a dispute not cleared | `review` | `pr-opened-for-review` | `none` |
| `conflict`, `github-unavailable` | `review` | `pr-opened-for-review` | `none` |
| `nesting-unavailable` | as the in-line steps leave it | as the in-line report says | as it says |

`pr-opened-for-review` only with a ticket in `review` or `readyToMerge`. If your own move failed or the status still disagrees with `TICKET_STATUS`, follow "When you hit a blocker" (`blocked`, `triage`) and report `in-progress-blocked`, `BLOCKER` naming it. The open findings go in the ticket note and at most 10 lines of context.
