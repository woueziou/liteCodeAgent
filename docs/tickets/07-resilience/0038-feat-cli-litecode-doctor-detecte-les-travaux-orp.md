---
schemaVersion: 2
id: 0038-feat-cli-litecode-doctor-detecte-les-travaux-orp
title: "feat(cli): litecode doctor détecte les travaux orphelins"
label: feature
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 6.

## Contexte
Rien ne détecte un travail abandonné en cours de route. GSD a health --repair et forensics.

## Critères d'acceptation
`litecode doctor` (sans écrire par défaut) signale :
- ticket inProgress sans worktree ni branche ;
- worktree sous `project.worktreeRoot` sans ticket actif correspondant ;
- branche de ticket poussée sans PR ;
- ticket review/readyToMerge dont la PR est fermée ou fusionnée ;
- dérive du lockfile d'installation ; plus les erreurs de `ticket doctor` et `config doctor`.
- Fonctionne hors ligne : les vérifications GitHub sont marquées « non vérifié » si gh est indisponible.
- Tests avec dépôt git temporaire.
