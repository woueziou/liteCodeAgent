---
schemaVersion: 2
id: 0065-perf-tickets-grouper-les-petits-tickets-lies-dan
title: "perf(tickets): grouper les petits tickets liés dans une seule PR"
label: feature
status: planned
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Les suivis non bloquants (0044, 0058, 0060…) ont chacun payé worktree, PR, CI et deux relectures.

## Critères d'acceptation
- dispatcher propose des lots : tickets `small` d'un même épic, sans fichiers en commun avec un autre lot, jusqu'à 4 par lot.
- implementer accepte un lot : une branche, une PR citant chaque ticket, une relecture qui vérifie les critères de chaque ticket ; chaque ticket suit son propre statut.
- chained-implementation sait lancer un lot.
- Tests de contrat.

## Plan
1. packs/core/agents/dispatcher.md, implementer.md (ou skill implementer-batch), reviewer.md.
2. packs/core/skills/chained-implementation.
3. tests/ + install --apply.

## Hors périmètre
Lots de tickets medium ou large.
