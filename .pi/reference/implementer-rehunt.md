---
name: implementer-rehunt
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Fixing a gap or a blocking finding after review (implementer)

Loaded by `implementer` when you, `reviewer` or `bug-hunter` notice a gap or a finding. Step numbers refer to `implementer`'s numbered flow.

## Any gap: fix it now, don't just log it

A gap noticed by you, `reviewer` or `bug-hunter` (a non-blocking finding, a "should also handle X") is fixed as the very next step: write the fix, then **re-run the verification that would catch it if wrong** (`bun run check`), not just re-read the diff. Never move to `Ready to Merge` on "I addressed the note" without that re-run.

## A blocking `bug-hunter` finding

The check is `bug-hunter` itself: commit and push the fix, re-invoke `bug-hunter` on the fixed branch with the worktree path (step 8), and post its new report on the PR (step 9) — `bun run check` says nothing about whether the failure scenario still happens. One re-hunt per run: a new blocking finding lands the ticket on `Review` with both reports, no looping.
