---
schemaVersion: 2
id: 0084-feat-cli-single-litecode-name-grouped-help-and-u
title: "feat(cli): Single litecode name, grouped help and upgrade announcement"
label: feature
status: done
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

- [x] Les messages de la CLI et l'aide emploient `litecode`. Règle (2026-10-02) : toute commande exécutée via `bunx` reste `bunx litecodeagent`, car `litecode` n'est pas dans le PATH sous `bunx` ; cela couvre les prompts d'agents, les exemples `bunx` du README et le message `Next:` de `src/init.ts`.
- [x] La commande dans l'outil est `/litecode` sur chaque install target. Le suivi du plugin est extrait dans le ticket 0091, car `bin/` et `.claude-plugin/` sont absents du dépôt.
- [x] `--help` est groupé par étape (installer, planifier, implémenter, diagnostiquer).
- [x] `install` n'apparaît plus comme commande destinée à l'utilisateur, et `--check` reste disponible pour la CI.
- [x] Après `setup`, la sortie annonce `litecode upgrade`.
- [x] Quand le projet est en retard sur la version installée, la CLI le signale au lancement.
- [x] Le package npm garde son nom.
- [x] Tests au seam 1 (sortie de l'aide, du setup et de l'avis de retard).

## Bloqué par

- 0083
