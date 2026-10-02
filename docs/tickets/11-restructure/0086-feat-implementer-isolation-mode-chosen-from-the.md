---
schemaVersion: 2
id: 0086-feat-implementer-isolation-mode-chosen-from-the
title: "feat(implementer): Isolation mode chosen from the install target"
label: feature
status: backlog
priority: high
size: large
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

L'implementer s'exécute en `worktree` ou en `inline` selon une clé `auto`, `worktree` ou `inline`. `auto` lit une table de capacités par install target (worktree natif sur Claude Code, absent ailleurs), surchargeable par config. Un nouvel ADR remplace en partie la décision 1 de l'ADR 0020.

## Critères d'acceptation

- [ ] Un ADR (format du dépôt) est écrit avant le code, et passe l'ADR 0020 en « partly superseded ».
- [ ] `auto` choisit `worktree` sur Claude Code et `inline` sur opencode, kilo-code, codex, pi et le `runner`.
- [ ] La table de capacités se surcharge par une clé de config, sans nouvelle version.
- [ ] `worktree` ou `inline` se force par projet ou par appel.
- [ ] Le mode inline est refusé sur un arbre de travail sale.
- [ ] Le mode inline est refusé si un autre implementer tourne déjà.
- [ ] Les écritures de tickets atteignent le checkout principal dans les deux modes.
- [ ] La taille du ticket n'influence pas `auto`.
- [ ] Tests au seam 3 (table, surcharge, refus inline, écritures de tickets).

## Bloqué par

- 0083
