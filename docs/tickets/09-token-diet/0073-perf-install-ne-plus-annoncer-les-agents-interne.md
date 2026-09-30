---
schemaVersion: 2
id: 0073-perf-install-ne-plus-annoncer-les-agents-interne
title: "perf(install): ne plus annoncer les agents internes de l'orchestrator dans chaque session"
label: feature
status: backlog
priority: low
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
`classifier`, `panel-selector`, `debate-angle`, `synthesizer` et `planner` ne sont appelés que par `orchestrator`, mais leurs descriptions sont listées dans chaque session sur chaque cible.

## Critères d'acceptation
- Pour chaque cible supportée, un document dans `docs/` indique si un agent peut être invocable par un autre agent sans être annoncé à la session principale, avec la source.
- Sur les cibles où c'est possible, l'installation applique ce masquage aux 5 agents internes ; un test le vérifie.
- Sur les cibles où ce n'est pas possible, rien ne change et le document le dit.
- `bun run check` et `bun test` passent ; fichiers installés régénérés.

## Plan
1. Vérifier, cible par cible, le mécanisme disponible (documentation officielle).
2. Écrire le document.
3. Implémenter le masquage là où il existe, dans le rendu d'installation.
4. Tests, régénération.

## Hors périmètre
Fusionner les agents internes dans orchestrator.
