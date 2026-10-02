---
generated_by: implementer
task: "0057"
---

# 0020. Implementer in an isolated worktree, ticket writes rooted explicitly

Status: accepted, partly superseded by ADR 0023
Date: 2026-09-29

> **Partly superseded (2026-10-02)**: decision 1 (non-claude-code targets always run `git worktree add` themselves) is replaced by ADR 0023, which chooses an Isolation mode (`auto`, `worktree`, `inline`) from the install target. Decisions 2 to 5 stand.

## Context

Despite ADR-less prose rules (ticket 0048), implementers kept writing first into the primary checkout (tickets 0050, 0052, 0054, 0055). Claude Code's `Agent` tool can start a sub-agent in its own git worktree (`isolation: "worktree"`), which removes the primary checkout from the agent's reach. But then the agent's `cwd` is that worktree from its very first turn, so any relative ticket write (status, notes) would land in the worktree instead of the primary checkout on the default branch, where `dispatcher`, `triage` and the dashboard read it.

## Decisions

1. **Delegation asks for isolation where the target has it.** `src/delegation.ts` gains a `{{> delegateImplementerIsolation}}` helper, used by the `chained-implementation` skill. Only `claude-code` documents a per-call option (`isolation: "worktree"`); `opencode`, `kilo-code`, `codex`, `pi` and the API `runner` have no documented equivalent, so they keep today's behavior (implementer runs `git worktree add` itself) plus the end-of-run leak check. No capability is invented for them.
2. **The provided worktree becomes the ticket worktree.** implementer does not run `git worktree add` a second time; it runs `git checkout -b <descriptive-name>/<NNNN>` inside the provided worktree (a new branch off the tip it already has; no rename of an existing branch).
3. **The caller states the primary checkout's absolute path in the prompt.** implementer cannot infer it from its `cwd`. If it was isolated but not told the path, that is a blocker for `triage`.
4. **Ticket writes go through the CLI with the existing global `--project <primary-checkout>` flag**, not a new `--root` flag: `ticket move --project <path> ...` and a new `ticket note <id> --file <path> --project <path>` (append-only). `--project` is stripped from argv before positional parsing so it works anywhere on the line. Ticket commits use `git -C <primary-checkout>`. Edit/Write on ticket files is no longer used.
5. **Leak cleanup is unchanged**: compare byte for byte with the worktree copy; discard only if identical, otherwise stop and report.

## Consequences

- A second flag with the same meaning as `--project` is avoided; the acceptance criterion "explicit main-checkout path" is met by the existing flag.
- Correctness of isolation relies on the caller passing the path (prose contract, tested on the pack text only).
- Non-claude-code targets gain nothing and lose nothing.
