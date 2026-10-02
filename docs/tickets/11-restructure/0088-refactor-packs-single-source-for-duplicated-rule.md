---
schemaVersion: 2
id: 0088-refactor-packs-single-source-for-duplicated-rule
title: "refactor(packs): Single source for duplicated rules"
label: chore
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

Chaque règle dupliquée a une source unique : test-first, protocole de lot et garde « instruction humaine explicite ». Le trailer d'agent tient en une ligne par agent. Une règle n'est retirée d'un texte que si un test ou une garde l'impose encore.

## Critères d'acceptation

- [ ] `reviewer-test-first` est la source du protocole test-first, et le fichier côté implementer se réduit à un point de contrôle et un renvoi.
- [ ] `implementer-batch` est la source du protocole de lot, et le fichier côté reviewer garde ses règles propres.
- [ ] La garde « instruction humaine explicite » de `chained-implementation` et `idea-to-planned` vient d'un partial commun.
- [ ] La règle du trailer d'agent est une ligne dans le corps de chaque agent concerné.
- [ ] Un test prouve que chaque règle retirée d'un texte reste imposée par un autre test ou une garde.
- [ ] Tests au seam 2 (rendu des packs).

## Bloqué par

- 0087
