---
schemaVersion: 2
id: 0090-chore-tokens-re-measure-the-reference-ticket-and
title: "chore(tokens): Re-measure the reference ticket and compare to the baseline"
label: chore
status: backlog
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Le ticket de référence mesuré en 0082 est mesuré de nouveau avec la même commande, et l'écart est consigné. C'est la réponse à Q4a (tokens de bout en bout) et Q4b (prompt par agent).

## Critères d'acceptation

- [ ] Le ticket de référence est rejoué dans les mêmes conditions que la base.
- [ ] Les tokens de bout en bout et la taille du prompt de chaque agent sont consignés dans `docs/specs/restructure-litecode.md`, à côté de la base.
- [ ] L'écart par rapport à la base est chiffré, avec l'analyse de ce qui l'explique.
- [ ] Si un indicateur a régressé, un ticket de suivi est ouvert.

## Bloqué par

- 0081, 0085, 0087, 0088, 0089 (0081 est dans `09-token-diet`)
