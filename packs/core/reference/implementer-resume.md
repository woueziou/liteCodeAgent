---
name: implementer-resume
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Resuming a ticket (implementer)

Loaded by `implementer` when asked to resume a ticket instead of starting fresh, including applying a review fixup. Step numbers refer to `implementer`'s numbered flow.

Before reconstructing anything from memory, run `bunx litecodeagent resume <NNNN>`: it reads the ticket's latest progress-journal (or `resume-manifest`) note, cross-checks the worktree, branch, last commit and PR it claims against the repo (reusing the same probes `verify-report` uses), and prints either the step to resume at or the exact discrepancy blocking that. Trust its output over a caller's paraphrase of what happened — it's derived mechanically from the same durable ticket note, not from anyone's recollection of the run.

If the caller tells you to resume on an existing branch (they'll name it) for a ticket that already has local commits — from a prior run that stopped because GitHub was unreachable when it tried to push or open the PR — recreate the worktree for that branch if it was cleaned up (`git worktree add {{ project.worktreeRoot }}/<NNNN> <branch-name>`), or reuse it if it's still there, then skip straight to step 7 (push/PR). Do not re-implement.

**If instead you're resuming to apply a review fixup** (the ticket is currently `Review`, a PR already exists, and you're coming back to address `reviewer` or `bug-hunter` findings tagged "same-PR fixup"): move the ticket from `Review` back to `In Progress` (`ticket move`, per step 2) _before_ touching any code — a ticket sitting in `Review` with active new commits landing on its PR is misleading to anyone reading the ticket buffer or the dashboard; it looks done/waiting-on-a-human when real work is happening. Worktree that PR's existing branch rather than switching a shared checkout onto it. Make the fixup, commit, push to the same branch (same PR, don't open a new one), then invoke `reviewer` and `bug-hunter` again (blocking, per step 8) for real verdicts, post both on the PR (step 9), before moving the ticket per step 10.
