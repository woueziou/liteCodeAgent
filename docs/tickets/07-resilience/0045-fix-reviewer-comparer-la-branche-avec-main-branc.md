---
schemaVersion: 2
id: 0045-fix-reviewer-comparer-la-branche-avec-main-branc
title: "fix(reviewer): comparer la branche avec main...branche (trois points), pas main..branche"
label: bug
status: planned
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
