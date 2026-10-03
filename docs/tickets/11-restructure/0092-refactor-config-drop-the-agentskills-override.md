---
schemaVersion: 2
id: 0092-refactor-config-drop-the-agentskills-override
title: "refactor(config): drop the agentSkills override, nothing is preloaded"
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

Depuis le ticket 0087, aucun agent ne précharge de skill par défaut. `project.agentSkills` reste pourtant lue au rendu (ligne `skills:` des agents), à l'installation (liste des skills voulus) et par des contrôles (`doctor`, ADR 0006). Décision (2026-10-03, option C du grilling) : la surcharge disparaît. Plus rien n'est jamais préchargé, et les skills se chargent à la demande par les règles de routage (Domain).

Conséquence assumée : une liste `agentSkills` écrite à la main n'est pas préservée. `upgrade` la retire déjà comme clé obsolète depuis 0083 ; il doit désormais le dire.

## Critères d'acceptation

- [ ] Un ADR (format du dépôt) est écrit avant le code : il remplace l'ADR 0006 (validation des chemins `agentSkills`) et acte qu'aucun préchargement n'existe.
- [ ] Le rendu ignore `project.agentSkills` : aucun agent rendu n'a de ligne `skills:`, quelle que soit la config.
- [ ] Les sources d'agents du pack ne référencent plus `project.agentSkills`.
- [ ] Les skills ne s'installent plus qu'à partir des règles de routage (Domain) et des angles ; `agentSkills` ne compte plus comme « skill voulu ».
- [ ] Les contrôles propres à `agentSkills` disparaissent : erreur d'installation sur clé manquante, `doctor --fix` qui les remplit, dérivation par défaut à l'init.
- [ ] Une config qui contient encore `agentSkills` s'installe sans erreur ; `doctor` avertit que la clé est ignorée.
- [ ] Le plan de `upgrade` nomme la clé retirée et dit que les listes personnalisées ne sont pas conservées.
- [ ] Le schéma de config reste tolérant à la clé (les anciennes configs se chargent).
- [ ] Tests au seam 2 (rendu sans ligne `skills:`) et seam 1 (install, `doctor` et `upgrade` sur une config qui porte `agentSkills`).

## Bloqué par

- 0087 (fait)
- 0088 : touche les en-têtes et corps des mêmes fichiers d'agents, donc à enchaîner pour éviter les conflits.
