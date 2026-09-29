---
name: implementer-leak-cleanup
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Checking the primary checkout for leaked writes (implementer)

Loaded by `implementer` right before its final report, whenever a sub-agent (a review pass or a subagent-driven implementation step) was delegated during the run.

A sub-agent delegated in step 8 (or in the subagent-driven implementation flow) can start in the primary checkout instead of your worktree and write there by mistake, even after being told the worktree path — that's exactly how tickets 0032 and 0045 leaked. Never skip this, on every path (blocked, verification-only, pending-GitHub, adr-pending-approval, and the normal PR path alike), right before you write your final `STATUS:` report:

1. In the **primary checkout** (not your worktree), run `git status --short --untracked-files=all` (plain `--untracked-files` defaults to collapsing a new directory into one `?? dir/` line, which would hide a leaked file living under a directory your branch newly created). Anything listed there is either yours from before this run (leave it alone) or a leak from this run.
2. For any file your branch touches that shows up modified/added in that output: compare the primary checkout's **working-tree** copy — not its committed `HEAD`, which for a tracked file is `main`'s old version and will almost always differ from the branch — against the branch's committed content: `cmp <primary-checkout>/<path> <(git -C <worktree> show HEAD:<path>)`. If it reports no difference, it's a leak with no information of its own — discard it in the primary checkout with `git -C <primary-checkout> restore --staged --worktree -- <path>` (works whether or not the leaked write was also `git add`ed there; a plain `checkout -- <path>` only restores from the index and leaves a staged leak in place) for a tracked path, `rm` for an untracked file that matches. If it differs from your branch (or belongs to a file your branch never touched), do not touch or discard it — it isn't yours to clean up; note it in your report instead.
3. Re-run `git status --short --untracked-files=all` in the primary checkout after cleanup and confirm it no longer shows any file your branch touches. Only then write your final report.
