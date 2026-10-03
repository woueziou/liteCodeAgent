# 0026. `litecode uninstall` removes only what a lockfile vouches for

Status: accepted
Date: 2026-10-03

## Context

Nothing removed litecode from a project: the README asked users to read each `.litecode-lock.json` and delete the listed files by hand. Deleting files is hard to undo, and a project mixes litecode's generated files with the user's own (skills under `.claude/`, other tools' folders, tickets, ADRs). Config and lockfiles are committed and nobody reviews them for path safety.

## Decision

1. **Form.** `litecode uninstall` is a preview by default: it writes nothing, exits 0, and lists what it would remove and what it keeps with the reason. `--apply` removes, `--yes` is accepted for scripts (same spelling as `setup`; `--apply` already means consent). `--force` and `--config` are the only widenings.
2. **Candidates come only from lockfiles.** Every per-harness lockfile (`lockPath(target)` for each target) and the hook lock `.githooks/.litecode-hook-lock.json` is read. A path not listed there is never touched. Each listed path must resolve inside the project root (no `..`, no absolute path, no symlinked directory leading out); one that does not is ignored with a message. The check is the one `upgrade` uses.
3. **Removed by default:** lockfile-listed files whose current sha256 prefix equals the lockfile entry; then the lockfiles themselves; then every directory the removals emptied. A directory is removed only when it is empty afterwards, never the project root, never one that still holds a file.
4. **Edited files (drift).** A file whose hash differs from its entry is kept and listed with the reason. `--force` removes it. The hash is checked again at apply time.
5. **Hook and `core.hooksPath`.** `.githooks/pre-commit` is removed only when it matches its hook lock hash (never a pre-existing hook, `--force` included, since no lock vouches for it). `core.hooksPath` is unset only when it equals `.githooks` and the hook lock exists: that lock is written by the same install step that sets the path, so its presence is the only record that litecode set it. Any other value is left, and the output says so. The lock is the evidence, git has no memory of who set the key. If the hook file was kept (edited) or other files remain in `.githooks`, the path is left too, so their hooks keep running, and the output says so. A hook kept for drift is never removed, `--force` included, and its lock entry stays.
6. **Config.** `litecode.config.json` is kept; `--config` removes it too.
7. **Never removed, whatever the options:** `docs/tickets/`, `docs/decisions/`, files not in a lockfile, branches, worktrees.
8. **No lockfile:** the command says so, deletes nothing, exits 0.
9. **Outside the project.** The command does not touch it. After a successful `--apply` it prints the exact commands (`/plugin uninstall litecode-agent@litecode`, `rm -rf ~/.litecode` for an `install.sh` clone) and lists remaining agent branches (`.../NNNN`) and worktrees with the commands to remove them, using `doctor`'s detection.

## Consequences

- A file litecode generated but whose lock entry was lost stays on disk; the user deletes it. Safe over complete.
- If the user set `core.hooksPath` to `.githooks` themselves and later installed litecode, uninstall resets it: the hook lock cannot tell the two apart. Accepted, and the hook file's own content check still protects a custom hook.
- A project uninstalled then re-installed with `setup --apply` is consistent again, since `--config` is opt-in and tickets and ADRs stay.
- A lockfile edited by hand can only shrink the candidate set or be rejected, never reach outside the project.
