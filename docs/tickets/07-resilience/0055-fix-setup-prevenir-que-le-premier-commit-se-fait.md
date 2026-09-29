---
schemaVersion: 2
id: 0055-fix-setup-prevenir-que-le-premier-commit-se-fait
title: "fix(setup): prévenir que le premier commit se fait sur une branche une fois le garde actif"
label: bug
status: review
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Depuis le ticket 0033, `install --apply` (et donc `setup --apply` et `upgrade`) écrit `.githooks/pre-commit` et active `core.hooksPath` quand c'est sans risque. Ce garde refuse tout commit sur la branche par défaut qui ne contient pas uniquement des fichiers de ticket. Un nouvel utilisateur qui suit le démarrage rapide fait ensuite `git commit` de la mise en place sur `main` : le commit est refusé, sans qu'aucune sortie de `setup`/`install` ne l'ait prévenu. Le README l'explique depuis la PR #94, mais la CLI ne dit rien.

## Critères d'acceptation
- Quand `install --apply` (y compris via `setup` et `upgrade`) vient d'activer le garde et que la branche courante est la branche par défaut, la sortie se termine par un avertissement clair : committer la mise en place sur une branche (commande `git switch -c …` suggérée), ou exception ponctuelle `LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT=1`, ou `project.allowDefaultBranchCommits: true`.
- Aucun avertissement quand la branche courante n'est pas la branche par défaut, ni quand `allowDefaultBranchCommits` vaut `true`, ni quand le garde n'a pas été activé (hook préexistant, `core.hooksPath` déjà défini).
- Le message d'erreur de `guard-branch` lui-même rappelle ces trois options (il en cite déjà deux ; vérifier qu'il suggère aussi `git switch -c`).
- Tests : présence et absence de l'avertissement selon chaque cas.

## Plan
1. src/install.ts : après `activateGitHooksPath`, avertissement conditionnel.
2. src/guard-branch.ts : message de refus.
3. tests/install.test.ts, tests/guard-branch*.test.ts.

## Hors périmètre
Changer la politique du garde.

### 2026-09-29 — implementer: PR opened, two review rounds, landed on Review

PR: https://github.com/woueziou/liteCodeAgent/pull/96 (branch `fix-setup-branch-warning/0055`, base `main`).

Implementation: `src/install.ts` (conditional warning after `activateGitHooksPath`, which
now returns `boolean` — true only when this exact call is the one that flips
`core.hooksPath` to `.githooks`), `src/guard-branch.ts` (refusal message now also suggests
`git switch -c`), plus tests in `tests/install.test.ts` and `tests/guard-branch.test.ts`.
Commit `efe2d03`.

**Round 1** (`reviewer` + `bug-hunter` on `efe2d03`):
- `reviewer` → `changes-requested`. Acceptance criteria and plan fidelity all satisfied,
  but blocking: the branch's one commit bundles the fix and its tests together, with no
  earlier commit where the tests existed and failed against pre-fix code — required
  because this ticket is `label: bug` (`project.testFirst: bugs`).
- `bug-hunter` → blocking finding: `upgrade`'s call into `applyPlan` (`src/project-upgrade.ts`)
  still passed only `{ force: false }`, so the new warning silently fell back to
  `"main"`/`false` instead of the project's real `defaultBranch`/`allowDefaultBranchCommits`
  — reproduced false positives/negatives on projects whose default branch isn't `main`.
  Also a non-blocking finding: `activateGitHooksPath` returned `true` without checking
  whether `git config core.hooksPath .githooks` actually succeeded.

Both bug-hunter findings fixed in commit `0aa5e7d`: `src/project-upgrade.ts` now threads
`ctx.config.project.defaultBranch`/`allowDefaultBranchCommits` through, with a new
regression test in `tests/project-upgrade.test.ts` using `defaultBranch: "master"`;
`activateGitHooksPath` now returns the git-config write's actual exit-code success.

**Round 2** (`reviewer` + `bug-hunter` re-invoked on `0aa5e7d`):
- `bug-hunter` → `HUNT: complete`, no blocking findings (one non-blocking: the hooksPath
  write failure is now correctly detected but still silent to the user — pre-existing
  behavior, not introduced by this PR; fine to defer to a new triage ticket).
- `reviewer` → still `changes-requested`: the test-first-ordering gap from round 1 is
  unchanged and stays blocking — a same-commit fix+test pair can't prove the bug was
  reproducible pre-fix, and `reviewer` explicitly declined to waive this given the
  constraint below. Its own reentry note: recommend landing on `Review` for a human to
  decide between accepting the gap (diff is correct and fully tested) or requesting a
  clean rebase on a new branch with test-first ordering restored.

**Why the test-first gap wasn't resolved by this run**: fixing it requires rewriting
already-pushed commit history (splitting `efe2d03` into a failing-test commit followed by
a fix commit) and force-pushing the branch. This session operates under a hard rule
forbidding `git push --force`/history rewriting on any branch, with no carve-out for an
unmerged feature branch, so that remedy wasn't available. `reviewer` was told this
explicitly in round 2 and asked to judge independently whether the finding should still
block — it held the finding as blocking on its own judgment, not merely deferring to the
constraint.

All four review reports (round 1 and round 2, `reviewer` and `bug-hunter` each) are posted
verbatim on PR #96 as comments.

Both `bun run check` and `bun test` (406 pass) are clean at HEAD (`0aa5e7d`).

A human should decide: accept the diff as-is (it's correct, plan-faithful, and fully
tested — just not test-first-ordered in history) and merge, or ask for a rebase onto a
new branch with test-first commit ordering restored.
