---
schemaVersion: 2
id: 0074-perf-packs-garantir-des-prompts-stables-pour-le
title: "perf(packs): garantir des prompts stables pour le cache"
label: chore
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Le cache de prompts ne fonctionne que si le texte des agents et skills installés est identique d'une installation à l'autre. Une date ou un horodatage rendu dans un corps de prompt casserait le cache.

## Critères d'acceptation
- Un test installe deux fois le pack core (même config, instants différents) et vérifie que les fichiers d'agents et de skills rendus sont identiques octet pour octet (le lockfile est exclu).
- Si une valeur volatile est trouvée, elle est retirée du rendu.
- `bun run check` et `bun test` passent.

## Plan
1. Écrire le test à partir des helpers d'installation existants (`buildPlan`/`applyPlan`).
2. Corriger toute valeur volatile détectée.

## Hors périmètre
Le contenu du lockfile.
