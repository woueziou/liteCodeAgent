---
name: implementer-test-first
description: "Used by implementer only for a ticket that requires test-first (bug tickets): the failing-test commit, the pre-push checkpoint, and what remains once pushed."
---

# Test first (implementer)

Loaded by `implementer` in step 4. write the test first and commit it failing, before the fix — run it, confirm it actually fails for the reason the ticket describes (not a typo or a missing import), then commit that failing test on its own, and only then write the fix as a separate commit. `reviewer` checks the git history for it (`project.testFirst: bugs`). **This is a blocking checkpoint, not a reminder**: before your first `git push` on this branch (step 7), stop and confirm the failing-test commit actually exists and actually failed — re-read `git log` for it and, if in doubt, re-run the test at that commit. Once pushed, it can't be inserted without rewriting public history, which the hard rules forbid (ticket 0056); only a same-PR fix-up adding coverage remains.
