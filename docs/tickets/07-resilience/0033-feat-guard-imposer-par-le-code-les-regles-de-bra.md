---
schemaVersion: 2
id: 0033-feat-guard-imposer-par-le-code-les-regles-de-bra
title: "feat(guard): imposer par le code les règles de branche et de statut"
label: feature
status: readyToMerge
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

### 2026-09-27 — implementer: round-3/4 fixup resumed, PR #76 now Ready to Merge

Resumed per the human's explicit direction to apply a same-PR fixup for round 2's 2 blocking bug-hunter findings.

**Round 3 fixup** (commit `d9268e5`): fixed both round-2 blocking findings.
1. `HookPlanEntry.status` gained a new `"preexisting"` value, distinct from `"drift"`: a `.githooks/pre-commit` litecode never installed (no prior lock entry — this repo's own author allow-list hook is exactly this case) is now reported as skipped, never written, never requires `--force`, and never blocks any other pending file's install/upgrade. A notice prints the exact `bunx --yes litecodeagent@<version> guard-branch` line to add to enable it manually.
2. `activateGitHooksPath()` now refuses to set `core.hooksPath` when it's already set to something else, or when `.git/hooks` already holds any non-`.sample` file (pre-commit-the-framework, lefthook, overcommit, a hand-written hook) — warning with manual-wiring instructions in both cases instead of acting or silently no-opping. Also warns (instead of silently no-opping) when the project root is a subdirectory of the git repo, using `realpath`-resolved paths against `git rev-parse --show-toplevel` to handle symlinked ancestors (macOS `/tmp` -> `/private/tmp`).
New tests: a pre-existing hook surviving install/upgrade untouched with the notice printed, and `core.hooksPath` staying unset when `.git/hooks` holds a non-sample hook.

Reviewer (round 3): `VERDICT: approve`, no findings, confirmed both fixes close the scenarios they targeted.

Bug-hunter (round 3, re-hunt of `d9268e5`): `HUNT: complete` with **2 new blocking findings**: (1) both notices printed `plan.hook.version` (the core pack's own, unpublished version, e.g. `0.4.0`) instead of the litecodeagent CLI version the rendered hook itself pins to — following the notice verbatim installed a `bunx` specifier that doesn't exist on npm, refusing every commit; (2) the subdirectory-project-root notice suggested a bare `guard-branch` line, but the hook always runs with cwd at the repo's git top-level while `guard-branch` reads `litecode.config.json` from its own cwd — following it verbatim refused every commit repo-wide in a monorepo. Plus 2 non-blocking: the `activateGitHooksPath` manual notice was unpinned (same failure mode, narrower), and the `.git/hooks`-already-has-hooks message said "your existing pre-commit hook" even when none existed and the real hook found was something else (e.g. `pre-push`).

**Round 3→4 fixup** (commit `d9db4de`): fixed all 4 round-3 findings. `HookPlanEntry` gained a `kitVersion` field (the actual pinned CLI version, distinct from `version`), both notices now use it; the subdirectory notice now suggests `(cd <relative-project-dir> && bunx --yes litecodeagent@<kitVersion> guard-branch)`; the `.git/hooks` message was reworded to "add this line to your pre-commit hook (create it if missing)". Updated the pinned-version test to assert the exact CLI version, and added a subdirectory-notice test.

Bug-hunter (round 4, re-hunt of `d9db4de`): `HUNT: complete`, **no blocking findings**. 3 non-blocking: (1) the "preexisting hook" notice (the other branch of `applyPlan`, not `activateGitHooksPath`) still lacked the subdirectory `cd` qualifier; (2) the `cd` path wasn't shell-quoted, breaking on a path containing a space; (3) the CLI-version pin will point to a version without `guard-branch` for the window between merging this PR and the next semantic-release publish — self-correcting, deferring is acceptable.

**Round 4 cheap-fix pass** (commit `039d2f9`, no additional bug-hunter re-hunt per "one re-hunt per run" — these were non-blocking and cheap): factored the version-pinned, cd-qualified, shell-quoted guard-branch line into a shared `guardBranchLine()` helper used by both notices; added `shellQuote()` for the `cd` argument. New tests: a pre-existing hook in a subdirectory project also gets the `cd` instruction, and a subdirectory path containing a space is correctly quoted. Left the unpublished-CLI-version-pin finding as-is (self-correcting, not fixed).

`bun run check` and `bun test` (269 pass, 0 fail) pass on the final branch state. Both PR reports (round 3 reviewer approve, round 3 bug-hunter 2-blocking-then-fixed, round 4 bug-hunter clean re-hunt) posted verbatim on PR #76. `gh pr view 76` shows `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`.

Deferred, not fixed here (per bug-hunter's REENTRY, narrow/self-correcting):
- The CLI-version pin (`kitVersion()`) can resolve to a published release without `guard-branch` if installed from an unreleased checkout between a merge and the next semantic-release version bump. Self-correcting once the release publishes; a human may want a follow-up ticket to fall back to `latest` or document not running `install --apply` from `main` in that window.
- (Still deferred from round 2, unrelated to this fixup, now ticket 0042) `ticket move`'s `parseTicket`/`serializeTicket` round-trip drops unknown frontmatter keys.

Ticket moved to `Ready to Merge`.
