---
schemaVersion: 2
id: 0091-chore-plugin-follow-the-litecode-command-rename
title: "chore(plugin): follow the /litecode command rename"
label: chore
status: backlog
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Le ticket 0084 renomme la commande dans l'outil en `/litecode` sur chaque install target. Le plugin Claude Code (`bin/`, `.claude-plugin/`) n'est pas dans le dépôt, donc ce suivi n'a pas pu être fait ni vérifié. Le test des métadonnées du plugin échoue déjà pour cette raison.

## Critères d'acceptation

- [ ] Décider où vit le plugin (ce dépôt ou un autre) et le versionner avec la CLI.
- [ ] La commande du plugin est `/litecode`.
- [ ] Le test des métadonnées du plugin passe.

## Bloqué par

- 0084
