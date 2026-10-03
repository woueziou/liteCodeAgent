---
name: implementer-test-first
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Test first (implementer)

Read by `implementer` in step 4. Write the test first and commit it failing, before the fix — run it, confirm it actually fails for the reason the ticket describes (not a typo or a missing import), then commit that failing test on its own, and only then write the fix as a separate commit. `reviewer` checks the git history for it (`project.testFirst: bugs`). **This is a blocking checkpoint, not a reminder**: before your first `git push` on this branch (step 7), stop and confirm the failing-test commit actually exists and actually failed — re-read `git log` for it and, if in doubt, re-run the test at that commit. What `reviewer` verifies, and why a rewrite is never the remedy once pushed, is in `.kilo/reference/reviewer-test-first.md` (relative to the primary checkout).
