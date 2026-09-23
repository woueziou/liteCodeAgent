---
schemaVersion: 2
id: 0031-feat-cli-litecode-upgrade-met-un-projet-a-jour-e
title: feat(cli): litecode upgrade met un projet à jour en une seule commande
label: feature
status: review
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Demande humaine (2026-09-23) : l'utilisateur doit pouvoir migrer avec l'utilitaire sans taper d'autre commande. Une seule commande, `litecode upgrade`, fait tout ce qu'une nouvelle version demande à un projet existant : re-rendu des agents, suppression des orphelins intacts, migration des tickets, nettoyage de la config et des fichiers de données obsolètes. Plan affiché puis confirmation (`--yes` pour les scripts). Voir l'ADR 0016.
