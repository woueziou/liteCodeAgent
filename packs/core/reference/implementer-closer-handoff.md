---
name: implementer-closer-handoff
description: Reference for implementer (not a skill; read on demand when the case arises).
install: handoff
---

# Handing the tail of the run to `closer` (implementer)

Loaded by `implementer` at step 8 when the handoff is on (ADR 0027). Step numbers refer to `implementer`'s numbered flow. `closer` waits for CI, runs and posts both reviews, sets the ticket status and writes its note; it never touches code. You keep the code, the disputes and the final report.

## Before delegating

The journal says `step 7: PR opened`. Write a ticket note ending in a `progress-journal` block (format: `implementer-progress-journal`) with `step: step 8: closer in flight`, `handoff: closer in flight` and `handoffAt: <now, ISO 8601 UTC>`, **before** you start `closer`: while that marker is under two hours old, `litecode resume` refuses to start a second writer on the worktree.

The brief is pointers, never pasted code: ticket id and file path, `size` and label, branch, base, PR number and URL, the worktree path (the primary checkout when the isolation mode is `inline`), the primary checkout's absolute path, the head commit, your last `CHECK_OUTPUT`, the expected CI test check(s), the attempt number (1 the first time) and the verdicts and counters of earlier attempts (re-hunts used).

## When it returns

Write a note with `handoff: returned` and a fresh `handoffAt`, in the same block format. Commit the ticket files `closer` changed (it never commits). Its block is `VERDICTS`, `CI`, `POSTED`, `TICKET_STATUS`, `NEEDS`, `EVIDENCE`, `TOKENS`. Re-read the ticket file: its `status` must equal `TICKET_STATUS`.

- `NEEDS: none`: send your single final report from the block (`CI` as returned, the PR, `CHECK_OUTPUT` as you had it). `TOKENS` is yours plus the closer's. The report format and `litecode verify-report` do not change.
- `NEEDS: code-fix:ci-red` or `code-fix:review`: the fix loop. Move the ticket `review` to `inProgress` **before** touching code (the rule of `implementer-resume`), fix (`implementer-ci-red`, `implementer-rehunt`), re-run `{{ project.checkCommand }}`, push, write `closer in flight` again and start a new `closer` with the attempt number plus one and the updated counters. At most **two relaunches**: if the third answer is still not `none`, stop as you would in-line: ticket `review`, note with the findings, final report. A finding that looks false, or asks for a history rewrite, is yours to dispute (`implementer-review-disputes`), never the closer's.
- `NEEDS: conflict` or `github-unavailable`: no loop. Ticket `review` with a note naming the evidence, then the final report; for a GitHub outage Read `implementer-github-outage`.
- `NEEDS: nesting-unavailable`: do the tail yourself, exactly as in-line: Read `implementer-inline-tail` and perform its steps 8 to 10.

Never send a report while a `closer` you started has not returned.
