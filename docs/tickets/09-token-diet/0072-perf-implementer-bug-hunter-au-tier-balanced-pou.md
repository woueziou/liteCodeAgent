---
schemaVersion: 2
id: 0072-perf-implementer-bug-hunter-au-tier-balanced-pou
title: "perf(implementer): bug-hunter au tier balanced pour les tickets small"
label: feature
status: planned
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`bug-hunter` est en `tier: reasoning` (opus). Pour un ticket `small` qui change de la logique (donc pas éligible à la passe unique), la relecture en deux passes lance opus sur un petit diff.

## Critères d'acceptation
- Dans le flux « Review flow by size » d'`implementer.md`, un ticket `small` en deux passes lance `bug-hunter` au tier `balanced` via `{{> delegateTier balanced}}` ; `medium`/`large` gardent le tier par défaut.
- Un test vérifie cette règle dans le texte.
- `bun run check` et `bun test` passent ; fichiers installés régénérés.

## Plan
1. Ajouter la règle dans la section « Review flow by size » d'implementer.
2. Ajouter le test.
3. Régénérer.

## Hors périmètre
Le tier de reviewer ; la passe unique existante.
