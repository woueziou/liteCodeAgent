---
schemaVersion: 2
id: 0083-feat-init-install-with-a-single-question-and-a-m
title: "feat(init): Install with a single question and a minimal config"
label: feature
status: done
priority: high
size: large
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

`litecode setup` ne pose qu'une question : valider les règles de routage (Domain) déduites de la stack. Les cibles sont préremplies d'après les outils présents sur le disque, et un résumé précède l'écriture. Le fichier généré est minimal, et `upgrade` nettoie les projets existants.

## Critères d'acceptation

- [ ] L'init interactive pose une seule question, formulée sans le mot « domain » : quand un ticket touche à…, quels guides l'agent doit-il lire ?
- [ ] Les règles sont proposées d'après la stack détectée et s'acceptent d'un geste ; elles se modifient ou s'ajoutent dans la même question.
- [ ] Si rien n'est détecté, l'init demande au moins une règle ; passer outre laisse l'install aboutir.
- [ ] En non interactif, les règles déduites sont écrites sans question.
- [ ] Les cibles sont préremplies d'après les outils trouvés sur le disque, et un résumé précède l'écriture.
- [ ] Nom du projet, branche par défaut, `checkCommand` et `typecheckCommands` sont détectés.
- [ ] Si `checkCommand` ou le dépôt GitHub est introuvable, l'install aboutit et l'agent concerné refuse avec un message nommant la commande `config set` exacte.
- [ ] Le fichier généré contient seulement targets, packs, nom, branche, `checkCommand`, `typecheckCommands` et les règles de routage ; `target`, `outDir`, `lessons` et `agentSkills` en sont absents, et `tiers`, `worktreeRoot`, `adrDir`, `language`, `conventions`, trust boundaries et angles prennent leur défaut, réglables par `config set`.
- [ ] `upgrade` retire les clés obsolètes d'une config existante.
- [ ] Tests au seam 1 (CLI dans un projet temporaire) pour chaque critère.

## Bloqué par

- Aucun. L'arête vers 0082 (base de mesure) est reportée : la base est mesurée plus tard, avant 0087.
