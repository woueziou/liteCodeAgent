---
generated_by: implementer
task: "0086"
---

# 0023. Isolation mode chosen from the install target

Status: accepted
Date: 2026-10-02

## Context

ADR 0020 decision 1 made delegation ask for a worktree wherever the target documents one, and had every other target run `git worktree add` itself. In practice the implementer is forced into a worktree even when the tool offers no isolation feature and a small team would rather work in the checkout it already has. The spec `docs/specs/restructure-litecode.md` asks for an Isolation mode the user can pick, with a sensible default per tool.

## Decision

This ADR partly supersedes ADR 0020, decision 1 only. Decisions 2 to 5 of ADR 0020 stay in force (a provided worktree becomes the ticket worktree, explicit primary checkout path, ticket writes through `--project`, byte-for-byte leak cleanup).

1. **Isolation mode** is a project setting `project.isolation` with three values: `auto` (default), `worktree`, `inline`. `worktree` is today's behavior. `inline` has the implementer work in the primary checkout, on a ticket branch, in the same session.
2. **`auto` reads a built-in capability table** per install target, kept next to `TARGET_INFO` in `src/config.ts`: `claude-code` supports worktrees natively, so `auto` gives `worktree`; `opencode`, `kilo-code`, `codex`, `pi` and the API `runner` do not, so `auto` gives `inline`. No capability is invented for a tool that does not document one.
3. **The table is overridable by config** through `project.worktreeSupport` (a map from target to boolean), so a user whose tool gains worktree support does not wait for a release. The key is optional with a default, so no config version changes.
4. **`worktree` or `inline` can be forced** per project (`project.isolation`) or per call (the caller states the mode in the delegation prompt; the call wins over the project).
5. **Inline is refused** on a dirty working tree (unrelated changes would mix into the ticket) and when another implementer is already running (two runs would collide). A lock file in the git common directory records the running implementer; a lock whose process is gone is stale and ignored.
6. **Ticket size never influences `auto`.**
7. **Ticket writes reach the primary checkout in both modes**: always `--project <primary-checkout>`, which in inline mode is the current directory.

## Consequences

- Users of tools without worktrees get a working implementer by default; Claude Code users keep isolation by default.
- Inline gives up the isolation guarantee of ADR 0020; the dirty-tree and single-run refusals replace it.
- The `git worktree add` fallback of ADR 0020 is no longer the default for those targets; it remains reachable by forcing `worktree`.
- The mode the agent follows rests on rendered pack text plus a CLI guard, tested at the pack text and CLI seams.
