# 0026. `litecode uninstall` removes only what a lockfile vouches for

Status: accepted
Date: 2026-10-03

## Context

Nothing removed litecode from a project: the README asked users to read each `.litecode-lock.json` and delete the listed files by hand. Deleting files is hard to undo, and a project mixes litecode's generated files with the user's own (skills under `.claude/`, other tools' folders, tickets, ADRs). Config and lockfiles are committed and nobody reviews them for path safety.

## Decision

1. **Form.** `litecode uninstall` is a preview by default: it writes nothing, exits 0, and lists what it would remove and what it keeps with the reason. `--apply` removes; it is already non-interactive, so a script uses `--apply` (there is no `--yes`, and it is rejected, not ignored). `--force` and `--config` are the only widenings. Only `--apply`, `--force` and `--config` are accepted: any other argument fails with exit 2 and a usage line before anything is read or touched, so a typo such as `--aply` or `--forc` can never turn into a silent preview or drop `--force`.
2. **Candidates come only from lockfiles.** Every per-harness lockfile (`lockPath(target)` for each target) and the hook lock `.githooks/.litecode-hook-lock.json` is read. A path not listed there is never touched. Each listed path must resolve inside the project root (no `..`, no absolute path, no symlinked directory leading out); one that does not is kept with a message. The check is the one `upgrade` uses. A lockfile that exists but is not valid JSON (or has no `files` table) is reported as unreadable with its path and reason, nothing is removed, and the exit code is 1.
3. **Removed by default:** lockfile-listed regular files whose current sha256 prefix equals the lockfile entry; then the lockfiles themselves; then every directory the removals emptied. A directory is removed only when it is empty afterwards, never the project root, never one that still holds a file.
4. **Edited files (drift).** A file whose hash differs from its entry is kept and listed with the reason. `--force` removes it. The hash is checked again at apply time. Anything that is not a regular file (a generated file replaced by a symlink or a directory) is kept with the reason "not a regular file"; a symlink is never followed, and `--force` unlinks the link itself, never its target. A file that cannot be read (`EACCES`, say) is kept with "cannot be read: <code>" and the run continues.
5. **Hook.** `.githooks/pre-commit` is removed only when it matches its hook lock hash. A hook that no longer matches (a hand edit, or a pre-existing hook no lock vouches for) is kept, `--force` included, and its lock entry stays so the lockfile survives. `core.hooksPath` is unset only under the rules in Consequences.
6. **Config.** `litecode.config.json` is kept; `--config` removes it too.
7. **Never removed, whatever the options:** `docs/tickets/`, `docs/decisions/`, files not in a lockfile, branches, worktrees.
8. **No lockfile:** the command says so, deletes nothing, exits 0.
9. **Allow-list.** A lockfile entry is accepted only when it lies inside a directory litecode itself writes to: each tool's directory (`TARGET_ROOTS`), each tool's skills directory (`SKILL_ROOTS`) and the configured `outDir`; the hook is accepted only through the hook lock, as exactly `.githooks/pre-commit`. Anything else a lockfile lists (`.git/`, `package.json`, the config file, any root file) is refused with "outside the directories litecode writes to" and nothing is deleted, in the preview, with `--apply` and with `--force`, even when the entry carries the file's real hash. The `docs/tickets`, `docs/decisions` and configured tickets-dir protection applies on top.
10. **Outside the project.** The command does not touch it. After an `--apply` that removed something (not after a preview, a no-op, or an unreadable lockfile) it prints the exact commands (`/plugin uninstall litecode-agent@litecode`, `rm -rf ~/.litecode` for an `install.sh` clone) and lists remaining agent branches (`.../NNNN`) and worktrees with the commands to remove them, using `doctor`'s detection.

## Consequences

- A file litecode generated but whose lock entry was lost stays on disk; the user deletes it. Safe over complete.
- If the user set `core.hooksPath` to `.githooks` themselves and later installed litecode, uninstall resets it: the hook lock cannot tell the two apart. Accepted, and the hook file's own content check still protects a custom hook.
- A project uninstalled then re-installed with `setup --apply` is consistent again, since `--config` is opt-in and tickets and ADRs stay.
- A lockfile edited by hand can only shrink the candidate set or be rejected, never reach outside the project.
- `core.hooksPath` is unset only when it equals `.githooks` and the hook lock exists: that lock is written by the same install step that sets the path, so its presence is the only record that litecode set it (git has no memory of who set the key). Any other value is left and the output says so. It is also left when the hook was kept, or when other files remain in `.githooks`, so their hooks keep running; the output says which.
- A hook kept because it was edited keeps its lock entry: the hook lock then stays, and so does the record that litecode set `core.hooksPath`.
- After a partial uninstall (an edited file kept), `setup --apply` stops on that file as drift until it is moved away or `--force` is used.
- Exit codes: 0 for a preview, for a successful `--apply` and for nothing to do; 1 when a requested removal failed or a lockfile is unreadable; 2 for a usage error. `--apply` prints what failed and never says "Uninstalled." in that case.
- A tampered lockfile can no longer reach `.git/`, project files or the config: the allow-list (decision 9) bounds it, not a list of exclusions that would have to be kept complete.
- `upgrade` still reads its options with `argv.includes`, so a typo there is silently ignored; this ADR does not change that.
