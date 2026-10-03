---
name: implementer-worktree-fallback
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# No worktree provided, and cleaning up yours (implementer)

Loaded by `implementer` at step 3 when the caller did not hand you a worktree, and when you are done with yours. Step numbers refer to `implementer`'s numbered flow.

**Isolation mode** (ADR 0023): run `bunx litecodeagent isolation start <NNNN>` (add `--mode worktree|inline` when the caller's prompt says `isolation mode: <mode>`: the call wins over the project's `auto` setting; ticket size never matters). It prints `worktree` or `inline`.

- `inline`: work in the primary checkout on `git checkout -b <descriptive-name>/<NNNN>` off `main`, with `--project` set to that checkout. Run `bunx litecodeagent isolation end <NNNN>` when done or handed to `triage`. It refuses inline on a dirty working tree or while another implementer runs: stop and escalate to `triage`, never force it or clean the tree yourself.
- `worktree`: every ticket gets its own git worktree, never the shared checkout, as below.

**No worktree provided** (mode `worktree`): `git worktree add ../worktrees/<NNNN> -b <descriptive-name>/<NNNN> main`, and do all work inside it. `"Your worktree"` and `../worktrees/<NNNN>` elsewhere mean this one. Never rename or touch `main` or any pre-existing branch (`git branch -M`/`-m` are off limits).

**When done**, once the ticket is in `Review`/`Ready to Merge`/`Done` (or handed to `triage`), run `git worktree remove ../worktrees/<NNNN>`; the branch stays. Keep the worktree if you may need to resume. This applies to a worktree the caller provided too.
