---
schemaVersion: 2
id: 0084-feat-cli-single-litecode-name-grouped-help-and-u
title: "feat(cli): Single litecode name, grouped help and upgrade announcement"
label: feature
status: backlog
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

La commande s'appelle `litecode` dans tous les messages, prompts et exemples du README, et `/litecode` dans l'outil. `--help` est groupé par étape du workflow. Après `setup`, la CLI annonce `litecode upgrade` et signale un projet en retard sur la version installée.

## Critères d'acceptation

- [ ] Plus aucun message, prompt ni exemple du README n'emploie `litecodeagent` hors de la première installation avec `bunx`.
- [ ] La commande dans l'outil est `/litecode` sur chaque install target, et le plugin suit.
- [ ] `--help` est groupé par étape (installer, planifier, implémenter, diagnostiquer).
- [ ] `install` n'apparaît plus comme commande destinée à l'utilisateur, et `--check` reste disponible pour la CI.
- [ ] Après `setup`, la sortie annonce `litecode upgrade`.
- [ ] Quand le projet est en retard sur la version installée, la CLI le signale au lancement.
- [ ] Le package npm garde son nom.
- [ ] Tests au seam 1 (sortie de l'aide, du setup et de l'avis de retard).

## Bloqué par

- 0083
