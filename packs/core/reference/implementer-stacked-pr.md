---
name: implementer-stacked-pr
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Stacked PR / follow-on branch (implementer)

Loaded by `implementer` when the ticket is a follow-on to another still-open, unmerged PR branch.

- Branch off that PR's branch instead of `{{ project.defaultBranch }}`: `git worktree add {{ project.worktreeRoot }}/<NNNN> -b <descriptive-name>/<NNNN> <pr-branch-name>`. Confirm this is really the right base before creating the worktree — don't guess.
- Open the PR with `--base <pr-branch-name>`, not `--base {{ project.defaultBranch }}`.
- A green `gh pr checks` is not proof the tests ran: a PR stacked on another PR branch does not trigger a workflow that only targets `{{ project.defaultBranch }}`, so only a third-party check (a secret scanner, say) may have run. Look at the check names — the expected test check(s) ({{ project.ci.testChecks | codelist }}, from `project.ci.testChecks`) must appear as passing; if they never ran, say so in your report and the ticket note (`CI: none`) instead of claiming a pass, and re-run the suite locally against the stacked branch.
- At step 10, a stacked PR whose base isn't `{{ project.defaultBranch }}` usually gets no test check: land on `Review` and say the suite's CI never ran, unless the project has no test check configured.
