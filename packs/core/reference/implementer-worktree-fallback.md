---
name: implementer-worktree-fallback
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# No worktree provided, and cleaning up yours (implementer)

Loaded by `implementer` at step 3 when the caller did not hand you a worktree, and when you are done with yours. Step numbers refer to `implementer`'s numbered flow.

You never work directly in the shared repo checkout; every ticket gets its own git worktree.

**No worktree provided**: `git worktree add {{ project.worktreeRoot }}/<NNNN> -b <descriptive-name>/<NNNN> {{ project.defaultBranch }}`, and do all work inside it. `"Your worktree"` and `{{ project.worktreeRoot }}/<NNNN>` elsewhere mean this one. Never rename or touch `{{ project.defaultBranch }}` or any pre-existing branch (`git branch -M`/`-m` are off limits).

**When done**, once the ticket is in `Review`/`Ready to Merge`/`Done` (or handed to `triage`), run `git worktree remove {{ project.worktreeRoot }}/<NNNN>`; the branch stays. Keep the worktree if you may need to resume. This applies to a worktree the caller provided too.
