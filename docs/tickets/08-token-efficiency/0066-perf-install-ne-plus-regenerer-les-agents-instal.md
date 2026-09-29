---
schemaVersion: 2
id: 0066-perf-install-ne-plus-regenerer-les-agents-instal
title: "perf(install): ne plus régénérer les agents installés dans chaque PR"
label: feature
status: backlog
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Presque chaque PR qui touche packs/ entre en conflit sur les trois lockfiles (.claude, .kilo, .pi) : intégration de main, `install --apply --force`, nouvelle CI, à chaque fois.

## Critères d'acceptation
- Choisir et documenter (ADR) une des options : (a) les PR ne modifient que packs/, et la régénération des fichiers installés se fait une fois après fusion (commande ou job CI qui ouvre une PR ou commit dédié) ; (b) un pilote de fusion git `.gitattributes` pour les lockfiles qui régénère au lieu de fusionner.
- Un contrôle (CI ou doctor) signale un écart entre packs/ et fichiers installés sur main.
- implementer.md suit le choix retenu.
- Tests.

## Plan
1. ADR.
2. Mise en œuvre de l'option retenue (src/install.ts, .github/workflows ou .gitattributes).
3. packs/core/agents/implementer.md ; tests/.

## Hors périmètre
Changer le format du lockfile.
