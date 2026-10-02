---
schemaVersion: 2
id: 0089-feat-tokens-token-control-drift-report-and-word
title: "feat(tokens): Token control: drift report and word budgets"
label: feature
status: backlog
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Un rapport de dérive montre la taille de chaque agent et skill face à la version précédente, sans bloquer. Un plafond de mots par agent et par skill, appliqué par `bun test`, attrape les régressions évidentes. Un ADR prolonge l'ADR 0021.

## Critères d'acceptation

- [ ] Un ADR (format du dépôt) est écrit avant le code et prolonge l'ADR 0021.
- [ ] Un rapport de dérive donne la taille de chaque agent et skill face à la version précédente, avec un avertissement au-dessus d'un seuil, et ne bloque rien.
- [ ] Un plafond de mots par agent et par skill est appliqué dans `bun test`.
- [ ] Les plafonds sont fixés d'après les tailles après les tickets 0087 et 0088.
- [ ] Le tokenizer n'est pas ajouté.
- [ ] Tests au seam 2 (plafonds) et seam 1 (rapport).

## Bloqué par

- 0088
