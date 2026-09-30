---
name: implementer-review-handoff
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Briefing the review passes and posting their reports (implementer)

Loaded by `implementer` at step 8. Step numbers refer to `implementer`'s numbered flow.

## What to give `reviewer` and `bug-hunter`

`reviewer` checks plan fidelity, conventions, verification and attribution; `bug-hunter` hunts correctness bugs, confirmed by running the code. Give both the PR, base, branch, the ticket's `size`, and **the absolute path of your worktree, stated as the directory every check and probe must run in, with an explicit instruction that neither may write, edit, or otherwise modify any file tracked by git anywhere else, and in particular never in the primary checkout** — a sub-agent starts in the primary checkout, where checks would hit `{{ project.defaultBranch }}` or leak files (tickets 0032, 0045). Give `reviewer` the plan too, and **the ticket file's path** — without it there is no `## Critères d'acceptation` to check against.

Neither pass is optional (except a single pass, which has only `reviewer`); don't move the ticket's status without every report you started. These calls **block** in effect: whether results return immediately or as later completion notifications, send no report — not a final `STATUS:`, not an interim "waiting on reviewer" — until both are in. A notification can only reach you after the current turn ends, so when one is pending, let the turn end without writing anything: that is the correct way to wait.

## Posting the reports (step 9)

Post `reviewer`'s full verdict (`VERDICT`/`FINDINGS`/`REENTRY`) and, if you ran it, `bug-hunter`'s full report (`HUNT`/`FINDINGS`/`REENTRY`), each verbatim, directly on the PR — on **every** path, `Review` or `Ready to Merge`. Write the text to a temporary file and post with `gh pr comment <pr-number> --body-file <path>` — never `--body "..."` with the verdict inlined (quoted code can contain backticks or `$(...)`). Neither agent posts itself, and a clean verdict is exactly the case that otherwise leaves no trace that a review happened. Verify it landed (`gh pr view <pr-number> --json comments`); a failed or unverified post is a blocker.

## Choosing the status (step 10)

**`Review`** instead of `Ready to Merge` if `reviewer` returned `changes-requested`, a blocking finding is unresolved, a check is failing after your fixup attempt (note the run's link) or still pending, `bug-hunter` returned `HUNT: partial` (say what it didn't reach), or either flagged something needing a human's judgment. A `plausible` blocking finding stays blocking until fixed or shown not to happen. On `Review`, the ticket note carries the full `FINDINGS`/`REENTRY`.
