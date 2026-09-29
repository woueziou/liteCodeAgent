---
schemaVersion: 2
id: 0066-perf-install-ne-plus-regenerer-les-agents-instal
title: "perf(install): ne plus régénérer les agents installés dans chaque PR"
label: feature
status: done
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Presque chaque PR qui touche packs/ entre en conflit sur les trois lockfiles (.claude, .kilo, .pi) : intégration de main, `install --apply --force`, nouvelle CI, à chaque fois.

## Critères d'acceptation
- Choisir et documenter (ADR) une des options : (a) les PR ne modifient que packs/, et la régénération des fichiers installés se fait une fois après fusion (commande ou job CI qui ouvre une PR ou commit dédié) ; (b) un pilote de fusion git `.gitattributes` pour les lockfiles qui régénère au lieu de fusionner.
- Un contrôle (CI ou doctor) signale un écart entre packs/ et fichiers installés sur main.
- implementer.md suit le choix retenu.
- Tests.

## Plan
1. ADR.
2. Mise en œuvre de l'option retenue (src/install.ts, .github/workflows ou .gitattributes).
3. packs/core/agents/implementer.md ; tests/.

## Hors périmètre
Changer le format du lockfile.

## ADR à valider : 0022

Brouillon en attente d'approbation, non committé (worktree /Users/woueziou/works/personal_projects/worktrees/0066).

---
generated_by: implementer
task: "0066"
---

# 0022. Installed agents are regenerated on main after merge, not in each PR

Status: proposed
Date: 2026-09-29

## Context

This repository dogfoods itself: `packs/` is the source, and `install --apply --force` renders it into `.claude/`, `.kilo/` and `.pi/`, each with a lockfile (`.litecode-lock.json`) listing every file's hash and an `installedAt` timestamp. Nearly every PR that touches `packs/` also regenerated those files, so two open PRs always conflicted on the three lockfiles (and on the rendered agents), forcing a merge of main, another `install --apply --force` and a new CI run each time.

## Decisions

Decision required: which way to stop regenerating installed files in every PR (ticket options a and b).

1. **Option (a) is retained: PRs change `packs/` only; installed files are regenerated once, after merge, by CI.** A new workflow `.github/workflows/sync-installed.yml` runs on `push` to `main`, executes `install --apply --force`, and if anything changed commits it as `chore(install): regenerate installed agents from packs/` and pushes to `main`. It skips runs started by `github-actions[bot]`, and a `GITHUB_TOKEN` push does not start further workflows, so it cannot loop. `implementer.md` says so (commit only `packs/`, never re-render or hand-resolve installed files).
2. **Option (b), a `.gitattributes` merge driver, is rejected.** A merge driver needs a `merge.<name>.driver` entry in each clone's git config (`.gitattributes` alone only names it), and GitHub's server-side merge never runs custom drivers, so it would not remove the conflicts that show up on the PR page.
3. **A gap is detected, not silently tolerated.** `litecode install --check` exits 1 when any installed file differs from what `packs/` renders (out of date or hand-edited) and writes nothing. `litecode doctor` reports it as a warning (`N installed file(s) are out of date with packs/`), except on a repository with nothing installed yet.
4. **Lockfiles stop churning.** `installedAt` is kept when a regeneration changes nothing else, so an unchanged re-run leaves the lockfile byte-identical.

## Consequences

- PR diffs shrink to `packs/`, tests and docs; the three-lockfile conflict disappears for ordinary PRs.
- Between a merge and the sync commit (minutes), main's installed files lag `packs/`; agents run from a checkout in that window use the previous rendering. `doctor` shows the gap.
- The sync job pushes to `main` directly with `contents: write`. If branch protection forbids that, the job fails visibly and the fix is a local `install --apply --force`; the workflow could then be changed to open a PR instead.
- The sync commit is authored by `github-actions[bot]`, outside the local git hooks that restrict authorship (`.githooks`, which run on the developer's machine only).
- The lockfile format is unchanged.

```resume-manifest
worktree: ../worktrees/0066
branch: install-drift-check/0066
commit: a5c84ad
adr_path: docs/decisions/0022-regenerate-installed-agents-on-main-not-in-prs.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: pass
adr_posted: true
```

### 2026-09-29 — implementer: ADR 0022 approved with one change, PR opened

The human approved ADR 0022 with one change: the sync workflow opens or updates a PR from the bot branch `chore/sync-installed` instead of pushing to main. ADR updated (Status: accepted), committed on its own (4d99863), workflow and tests updated. PR: https://github.com/woueziou/liteCodeAgent/pull/115

```progress-journal
step: step 7: PR opened
worktree: ../worktrees/0066
branch: install-drift-check/0066
base: main
commit: see PR head
checks: bun run check: pass; bun test: pass
pr: https://github.com/woueziou/liteCodeAgent/pull/115
```

### 2026-09-29 — implementer: review outcome, moved to Review

PR: https://github.com/woueziou/liteCodeAgent/pull/115 (CI: test pass on the head commit). reviewer: changes-requested (blocking hook issue, fixed). bug-hunter: complete; first pass and re-hunt findings are posted verbatim in substance on the PR. The re-hunt's new blocking finding (orphans counted but never deleted by `install --apply`) was resolved by reverting the orphan counting; it was not re-hunted (one re-hunt per run), so this goes to Review for a human. Follow-up ticket needed: delete orphans safely on apply, and handle a deselected harness's lockfile (both make `--check`/doctor accurate about orphans).

```progress-journal
step: step 10: Review
worktree: ../worktrees/0066
branch: install-drift-check/0066
base: main
commit: pushed head of PR 115
checks: bun run check: pass; bun test: 593 pass
pr: https://github.com/woueziou/liteCodeAgent/pull/115
```
