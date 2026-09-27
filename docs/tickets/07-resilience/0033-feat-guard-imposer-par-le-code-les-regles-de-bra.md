---
schemaVersion: 2
id: 0033-feat-guard-imposer-par-le-code-les-regles-de-bra
title: "feat(guard): imposer par le code les règles de branche et de statut"
label: feature
status: inProgress
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27 (litecodeagent vs GSD / Superpowers / Spec Kit), point 1.

## Contexte
Les règles critiques ne vivent que dans la prose des prompts : ne jamais commiter sur la branche par défaut (règle ajoutée à implementer le 2026-09-27), transitions de statut, attribution. `agent-attribution` admet que les restrictions d'outils ne sont pas appliquées ; tout agent peut écrire n'importe quel `status` dans le frontmatter.

## Critères d'acceptation
- Un hook `pre-commit` (dans `.githooks/` et rendu pour les projets cibles) refuse un commit sur `project.defaultBranch`, sauf si la config l'autorise explicitement (ex. `allowDefaultBranchCommits: true`) ou si une variable d'env d'override est posée par l'humain.
- `litecode ticket move <id> <status>` valide la machine d'états (ex. `planned → review` refusé, `inProgress` requis avant `review`/`readyToMerge`) et écrit le statut.
- implementer, dispatcher et triage utilisent `ticket move` au lieu d'éditer le frontmatter à la main.
- Tests couvrant les transitions refusées et le hook.

## Hors périmètre
Hook `PreToolUse` Claude Code : optionnel, à évaluer séparément.

### 2026-09-27 — implementer: PR opened, two review rounds, landing on Review

PR: https://github.com/woueziou/liteCodeAgent/pull/76 (branch `feat/guard-branch-status-rules/0033`, base `main`)

Implemented all 4 acceptance criteria: `src/guard-branch.ts` + `litecode guard-branch` CLI command + `packs/core/hooks/pre-commit` (rendered into target projects via `src/install.ts`'s new `HookPlanEntry`, drift-detected, executable) + this repo's own `.githooks/pre-commit` updated; `ALLOWED_TRANSITIONS`/`isTransitionAllowed` status machine in `src/tickets/spec.ts` + `litecode ticket move <id> <status>` CLI command; `packs/core/agents/implementer.md`/`dispatcher.md`/`triage.md` updated to call `ticket move` instead of hand-editing frontmatter; new tests in `tests/guard-branch.test.ts`, `tests/guard-branch-cli.test.ts`, `tests/tickets-transitions.test.ts`, plus additions to `tests/ticket-cli.test.ts`/`tests/install.test.ts`.

**Round 1** (commit `8aeb280`): `reviewer` returned `VERDICT: approve`. `bug-hunter` returned `HUNT: complete` with 4 blocking findings: (1) `review -> inProgress` missing from the status machine, breaking the same-PR-fixup resume flow implementer.md itself describes; (2) `planHook` silently overwrote a pre-existing, unlocked `.githooks/pre-commit` (no drift check when there's no prior lock entry); (3) the hook was invisible to `install`'s dry-run and to `upgrade`'s drift/changed detection; (4) the rendered hook was never actually activated in a consumer project (nothing set `core.hooksPath`). Plus 3 non-blocking findings (unpinned `bunx litecodeagent` version, `ticket move` not accepting a bare `NNNN` id, unknown frontmatter keys dropped on `ticket move`'s round-trip).

**Fixup** (commit `ba5898b`): fixed all 4 blocking findings plus, cheaply, 2 of the non-blocking ones (version pinning via a new `kitVersion()` helper interpolating `__LITECODE_VERSION__`; bare-`NNNN` id support in `ticket move`). Added `activateGitHooksPath()` in `src/install.ts` to set `core.hooksPath` when unset.

**Round 2** (re-hunt/re-review of `ba5898b`, per the "one re-hunt per run" rule): `reviewer` returned `VERDICT: approve` again, confirming each round-1 fix actually closes the scenario it targeted. `bug-hunter` returned `HUNT: complete` but with **2 new blocking findings introduced by the fixup itself**:
1. The new drift check for an unlocked hook (fix for round-1 finding #2) has no non-destructive way out: a project with its own pre-existing `.githooks/pre-commit` (this repo included — its author allow-list hook) is now permanently blocked from `install`/`upgrade` on *any* file unless `--force`, and `--force` deletes that project's own hook content. Confirmed: on a `git archive` copy of this repo at `ba5898b`, `install --apply` refused with 10 pending agent re-renders un-written, and `install --apply --force` did strip the author allow-list hook.
2. `activateGitHooksPath()` (fix for round-1 finding #4) sets `core.hooksPath` to `.githooks` whenever it's unset, with no check for pre-existing hooks already living in `.git/hooks` (the layout used by `pre-commit`-the-framework, lefthook, overcommit — e.g. a secret-scanning hook). Confirmed: a scratch repo with an executable `.git/hooks/pre-commit` had it silently stop running after `install --apply`, with nothing printed about the config change.

Plus 2 more non-blocking findings: subdirectory project roots make the hooksPath activation a no-op (git reads `core.hooksPath` relative to the worktree top, not the project root), and the version-pin can still resolve to a published release without `guard-branch` if installed from an unreleased checkout between a merge and the next semantic-release version bump.

Per the "one re-hunt per run" rule, I'm landing this on `Review` rather than attempting a second fixup-and-rehunt loop. All 4 review/hunt reports (round 1 reviewer + bug-hunter, round 2 reviewer + bug-hunter) are posted verbatim as PR comments on #76.

**What still needs doing before this can go to Ready to Merge** (round 2's 2 new blocking findings — REENTRY says same-PR fixup, Priority high):
- Give the hook-drift check a non-destructive path for a project's own pre-existing, unlocked `.githooks/pre-commit`: report it as skipped (or gate hook management behind an opt-in config key) instead of blocking every other file's install/upgrade.
- Make `activateGitHooksPath()` check for existing hooks under `.git/hooks` (any non-`.sample` file) before setting `core.hooksPath`, and print whatever config change it does make.
- (optional, cheap while touching the same function) Compare against `git rev-parse --show-toplevel` so a subdirectory project root doesn't silently no-op the activation.

Not yet fixed, deferred to a new ticket per bug-hunter's REENTRY (non-blocking, narrow): `ticket move`'s `parseTicket`/`serializeTicket` round-trip silently drops unknown frontmatter keys, unlike `ticket migrate`'s explicit refuse-unless-`--force` policy.

Worktree left in place at `../worktrees/0033` on branch `feat/guard-branch-status-rules/0033` for whoever picks this back up.
