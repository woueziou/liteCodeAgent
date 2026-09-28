---
schemaVersion: 2
id: 0045-fix-reviewer-comparer-la-branche-avec-main-branc
title: "fix(reviewer): comparer la branche avec main...branche (trois points), pas main..branche"
label: bug
status: done
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Sur la PR #81 (0036), reviewer a rendu `changes-requested` avec un finding bloquant faux : il croyait que la PR remettait le statut du ticket 0036 à `planned`. La PR ne touche aucun fichier de ticket (`gh pr diff 81 --name-only`). Depuis la PR #77, les agents commitent chaque changement de ticket sur `main` pendant qu'une branche est ouverte : une comparaison à deux points (`main..branche` ou `git diff main branche`) montre ces commits de `main` comme s'ils étaient annulés par la PR. L'implémenteur a alors passé le ticket en `readyToMerge` sans nouvelle approbation du reviewer, en contournant sa propre règle.

## Critères d'acceptation
- reviewer et bug-hunter évaluent le diff de la PR avec `git diff <base>...<branche>` (trois points, depuis la merge-base) ou `gh pr diff`, jamais un diff à deux points entre la base à jour et la branche.
- Le prompt dit explicitement que des commits de tickets sur la base, postérieurs à la merge-base, ne font pas partie de la PR.
- implementer : un finding bloquant du reviewer jugé faux positif exige une nouvelle passe de reviewer (avec la preuve) avant `readyToMerge` ; sinon le ticket va en `review`.
- Test de contrat sur les prompts ; agents installés régénérés.

## Plan
1. packs/core/agents/reviewer.md et bug-hunter.md : consigne de diff à trois points.
2. packs/core/agents/implementer.md étape 10 : règle du faux positif.
3. tests/agents-* + `install --apply`.

## Hors périmètre
Changer la façon dont les tickets sont commités (PR #77).

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/83 (branch `fix-reviewer-triple-dot-diff/0045`, base `main`)

Implemented: reviewer.md and bug-hunter.md now instruct diffing `<base>...<branch>` (three dots, from the merge-base) or `gh pr diff`, never a two-dot/no-dot diff, and both state explicitly that ticket-status commits landed on the base after the merge-base (per PR #77) are not part of the PR. implementer.md step 10 adds the false-positive rule: a blocking `reviewer` finding believed to be a false positive requires re-invoking `reviewer` with evidence before `readyToMerge`, and now also requires posting that second verdict on the PR (added as a same-PR fixup after bug-hunter's first pass, see below). Added `tests/agents-diff-scope.test.ts`; installed agents regenerated.

First-pass verdicts:
- `reviewer`: `VERDICT: approve`, `ACCEPTANCE`: all four criteria satisfied, `FINDINGS: none`, `PLAN_FIDELITY: matches`.
- `bug-hunter`: `HUNT: complete`, two non-blocking `plausible` findings:
  1. Step 10's false-positive rule didn't say to post the second `reviewer` verdict on the PR — fixed same-PR (commit 82ef802): step 10 now requires posting the second pass's full verdict on the PR too, verified with `bun run check` (clean) and `bun test` (310 pass). Not re-hunted separately since the finding was non-blocking.
  2. The false-positive re-run rule only covers `reviewer`; a *confirmed* blocking `bug-hunter` finding believed false could still be waved off without a re-run. Out of scope for 0045's acceptance criteria (which only names `reviewer`) — deferred as a possible follow-up ticket for `triage`/a human to consider.

Both full reports posted verbatim on the PR: https://github.com/woueziou/liteCodeAgent/pull/83#issuecomment-5867667308 (reviewer) and https://github.com/woueziou/liteCodeAgent/pull/83#issuecomment-5867667924 (bug-hunter).

`bun run check` and `bun test` (310 pass, 0 fail) green on the final commit. No merge conflicts. Moved `inProgress` → `readyToMerge`.
