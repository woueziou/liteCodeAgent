---
schemaVersion: 2
id: 0085-feat-doctor-unify-diagnostics-in-a-single-doctor
title: "feat(doctor): Unify diagnostics in a single doctor"
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

Un seul `doctor`, avec `--fix`, absorbe les contrôles de tickets et de config. Il vérifie que le routage vers les skills (Domain) pointe vers des skills installés, et prévient quand la stack contient une technologie sans règle.

## Critères d'acceptation

- [ ] `litecode doctor` couvre les contrôles de l'ancien `doctor`, de `ticket doctor` et de `config doctor`.
- [ ] `--fix` applique les corrections que faisait `config doctor --fix`.
- [ ] `doctor` échoue clairement quand une règle de routage cite un skill absent des packs installés.
- [ ] `doctor` avertit quand la stack détectée contient une technologie sans règle de routage.
- [ ] `doctor` avertit « aucune règle de routage » quand l'utilisateur a passé la question à l'init.
- [ ] Les anciennes commandes `ticket doctor` et `config doctor` disparaissent de l'aide.
- [ ] Tests au seam 1 (sortie et code de sortie de `doctor`).

## Bloqué par

- 0084
