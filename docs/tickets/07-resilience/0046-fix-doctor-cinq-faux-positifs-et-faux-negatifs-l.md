---
schemaVersion: 2
id: 0046-fix-doctor-cinq-faux-positifs-et-faux-negatifs-l
title: "fix(doctor): cinq faux positifs et faux négatifs laissés par bug-hunter sur la PR #82"
label: bug
status: inProgress
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants de bug-hunter sur la PR #82 (ticket 0038, `litecode doctor`), laissés hors de la PR. Détail et reproduction dans les commentaires de la PR #82.

## Critères d'acceptation
- `checkStalePrStatus` (src/doctor.ts) : un ticket avec deux branches (une première tentative dont la PR est fermée, une seconde dont la PR est ouverte) ne produit pas d'alerte.
- Même check : une branche distante supprimée après fusion (`gh pr merge --delete-branch`) ne masque plus une PR fusionnée ou fermée (faux négatif).
- `doctor` lancé depuis un worktree de ticket résout `project.worktreeRoot` par rapport au checkout principal, pas au worktree.
- Un worktree « prunable » (dossier supprimé, encore enregistré) n'est pas compté comme présent ; il est signalé comme à nettoyer (`git worktree prune`).
- Un seul `gh pr list` par branche entre les deux checks de PR (mise en cache dans l'exécution).
- Un test par cas.

## Plan
1. src/doctor.ts : les cinq corrections.
2. tests/doctor.test.ts : un test par cas, dépôts git temporaires.

## Hors périmètre
Nouveaux checks.
