---
schemaVersion: 2
id: 0084-feat-cli-single-litecode-name-grouped-help-and-u
title: "feat(cli): Single litecode name, grouped help and upgrade announcement"
label: feature
status: inProgress
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

- [ ] Les messages de la CLI et l'aide emploient `litecode`. Décision (2026-10-02) : les prompts d'agents gardent `bunx litecodeagent`, car `litecode` n'est pas dans le PATH sous `bunx`. Reste à trancher pour les exemples `bunx` du README (lignes 94, 102, 131, 179, 200, 216, 219) et `src/init.ts:268`.
- [ ] La commande dans l'outil est `/litecode` sur chaque install target, et le plugin suit.
- [ ] `--help` est groupé par étape (installer, planifier, implémenter, diagnostiquer).
- [ ] `install` n'apparaît plus comme commande destinée à l'utilisateur, et `--check` reste disponible pour la CI.
- [ ] Après `setup`, la sortie annonce `litecode upgrade`.
- [ ] Quand le projet est en retard sur la version installée, la CLI le signale au lancement.
- [ ] Le package npm garde son nom.
- [ ] Tests au seam 1 (sortie de l'aide, du setup et de l'avis de retard).

## Bloqué par

- 0083

## Reste à faire

- Exemples `bunx litecodeagent` du README et message de `src/init.ts` : à aligner ou à garder, selon la décision sur les prompts.
- Plugin : `bin/` et `.claude-plugin/` sont absents du dépôt, donc « le plugin suit » ne peut pas être vérifié.
