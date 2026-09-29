---
name: implementer-stacked-pr
description: "Used by implementer only when a ticket is a follow-on to another unmerged PR branch: choosing the base, and why a green gh pr checks may not mean the tests ran."
---

# Stacked PR / follow-on branch (implementer)

Loaded by `implementer` when the ticket is a follow-on to another still-open, unmerged PR branch.

- Branch off that PR's branch instead of `main`: `git worktree add ../worktrees/<NNNN> -b <descriptive-name>/<NNNN> <pr-branch-name>`. Confirm this is really the right base before creating the worktree — don't guess.
- Open the PR with `--base <pr-branch-name>`, not `--base main`.
- A green `gh pr checks` is not proof the tests ran: a PR stacked on another PR branch does not trigger a workflow that only targets `main`, so only a third-party check (a secret scanner, say) may have run. Look at the check names — the expected test check(s) (`test`, from `project.ci.testChecks`) must appear as passing; if they never ran, say so in your report and the ticket note (`CI: none`) instead of claiming a pass, and re-run the suite locally against the stacked branch.
- At step 10, a stacked PR whose base isn't `main` usually gets no test check: land on `Review` and say the suite's CI never ran, unless the project has no test check configured.
