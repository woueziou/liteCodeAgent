---
schemaVersion: 2
id: 0090-chore-tokens-re-measure-the-reference-ticket-and
title: "chore(tokens): Re-measure the reference ticket and compare to the baseline"
label: chore
status: inProgress
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

- [x] Le ticket de référence est rejoué avec `docs/specs/restructure-baseline/replay.sh`, cinq runs, isolation fixée à `inline`, mêmes conditions que la base.
- [x] Les tokens de bout en bout et la taille du prompt de chaque agent sont consignés dans `docs/specs/restructure-litecode.md`, à côté de la base.
- [x] L'écart par rapport à la base est chiffré avec sa dispersion, avec l'analyse de ce qui l'explique ; un écart inférieur à environ 20 % est déclaré non prouvé.
- [x] Si un indicateur a régressé, un ticket de suivi est ouvert. Aucun n'a régressé de façon significative (le coût recule de 2,6 %, intervalle -21 % à +16 %) : pas de ticket.

## Bloqué par

- 0081, 0085, 0087, 0088, 0089 (0081 est dans `09-token-diet`)

## Résultat (intermédiaire, 2026-10-03)

Dix runs par condition. Tokens -8,1 % (intervalle à 95 % de -23 % à +6,8 %), coût -2,6 %, tours -5,7 %, tokens de sortie -7,7 %. **Non prouvé** : tous les intervalles contiennent zéro et tous les écarts sont sous la barre de 20 %. Les cinq premiers runs de chaque côté donnaient -17 % sur les tokens ; dix runs l'ont ramené à -8 %. Le prompt rendu des 12 agents n'a pas changé (10 331 mots contre 10 334). Détails, limites et pistes dans `docs/specs/restructure-baseline/README.md`.

Le ticket reste ouvert : il est bloqué par 0081 (relais de contexte après la PR), et ce protocole s'arrête avant la PR, donc il ne peut pas mesurer l'effet du 0081. À refaire avec un protocole qui ouvre une PR pour juger l'ensemble.
