---
name: chained-implementation-no-report
description: Reference for chained-implementation (not a skill; read on demand when the case arises).
---

# `implementer` returned no final report (chained-implementation)

Loaded by `chained-implementation` at step 6, when `implementer`'s completion notification carries no final report.

Your own call to `implementer` in step 3 can itself resolve as a later completion notification instead of within the same turn (see "Delegating") — a bare background-launch acknowledgement for that call is not "no final report", it's `implementer` still running: wait for its actual completion notification before doing anything with step 4. Separately, `implementer` delegates to `reviewer`/`bug-hunter` mid-run, and on some targets those calls resolve as later completion notifications too — that is expected, not a fault of `implementer`. But if `implementer`'s own completion notification, once it does arrive, still carries no final report at all (nothing you can pass to `verify-report`, e.g. it stopped after an interim "waiting" message, or the invocation simply never produced a result), do not fabricate one and do not assume success or failure. `litecode verify-report` on empty input already fails with an explicit error rather than passing silently — run it anyway so that failure is on record — then check yourself, and tell the human plainly that `implementer` returned no final report and that you had to check by hand: look at whether a PR exists for the ticket's branch, whether `reviewer`/`bug-hunter` verdicts were actually posted on it, and what the ticket file's own `status`/notes say, and relay what you find instead of guessing.
