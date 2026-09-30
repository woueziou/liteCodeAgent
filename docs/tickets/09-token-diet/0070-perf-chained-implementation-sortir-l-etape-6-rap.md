---
schemaVersion: 2
id: 0070-perf-chained-implementation-sortir-l-etape-6-rap
title: "perf(chained-implementation): sortir l'étape 6 (rapport absent) en référence"
label: chore
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`packs/core/skills/chained-implementation/SKILL.md` étape 6 (cas où implementer ne rend pas de rapport) est un long paragraphe chargé à chaque enchaînement pour un cas rare.

## Critères d'acceptation
- L'étape 6 est remplacée par une ligne renvoyant à `packs/core/reference/chained-implementation-no-report.md` (nouveau fichier, contenu inchangé).
- `bun run check` et `bun test` passent ; fichiers installés régénérés.

## Plan
1. Créer la référence avec le texte actuel de l'étape 6.
2. Remplacer l'étape 6 par un renvoi `{{> reference chained-implementation-no-report}}` (même mécanisme que `implementer-batch`).
3. Adapter les tests qui ciblent ce texte ; régénérer.

## Hors périmètre
Les autres étapes du skill.
