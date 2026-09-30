---
schemaVersion: 2
id: 0077-feat-tickets-proposer-le-domaine-a-la-creation-e
title: "feat(tickets): proposer le domaine à la création et filtrer par domaine dans le dashboard"
label: feature
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Une fois le champ `domain` disponible, il faut que les tickets le reçoivent sans effort et que le dashboard permette de ne voir que son domaine.

## Critères d'acceptation
- `planner` propose une ligne `DOMAIN:` (un ou plusieurs domaines parmi `tickets.domains`) dans sa sortie ; `orchestrator` la relaie ; `tracker` passe `--domain` à `ticket new` quand elle est présente.
- Le dashboard affiche le domaine de chaque ticket et permet de filtrer par domaine, en plus des filtres existants.
- Les textes d'agents modifiés restent dans le budget de taille existant (tests de budget inchangés).
- Fichiers installés régénérés ; `bun run check` et `bun test` passent.

## Plan
1. Ajouter `DOMAIN:` à la sortie de `planner`, au relais d'`orchestrator` et à la consigne de `tracker`.
2. Ajouter le domaine au rendu et au filtre du dashboard (`src/dashboard/`).
3. Tests, régénération.

## Hors périmètre
Le champ lui-même (ticket précédent) ; l'attribution à des personnes.
