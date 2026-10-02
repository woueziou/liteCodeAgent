---
schemaVersion: 2
id: 0082-chore-tokens-merge-ready-token-diet-tickets-and
title: "chore(tokens): Merge ready token-diet tickets and measure a reference ticket"
label: chore
status: done
priority: medium
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Parent

`docs/specs/restructure-litecode.md`

## Contexte

Les six tickets prêts de l'epic `09-token-diet` sont mergés et un ticket de référence est mesuré avec `token-report`. Le chiffre sert de base de comparaison pour toute la restructuration (Q4a et Q4b).

## Critères d'acceptation

- [x] Les tickets `readyToMerge` de `09-token-diet` sont mergés (0069, 0070, 0071, 0073, 0074, 0075, déjà dans `main`).
- [x] Un ticket de référence (taille S, backend) est choisi et nommé dans la spec : le ticket `0001` d'un projet fictif, rejoué par `docs/specs/restructure-baseline/`.
- [x] Ses tokens de bout en bout et la taille du prompt de chaque agent sont consignés dans `docs/specs/restructure-litecode.md` et `docs/specs/restructure-baseline/README.md`.
- [x] La commande et la version utilisées pour mesurer sont notées, pour refaire la mesure à l'identique (`docs/specs/restructure-baseline/README.md`).

## Bloqué par

- Aucun (peut démarrer tout de suite).
