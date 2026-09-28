---
schemaVersion: 2
id: 0036-feat-reviewer-verifier-chaque-critere-d-acceptat
title: "feat(reviewer): vérifier chaque critère d'acceptation avec une preuve"
label: feature
status: inProgress
priority: medium
size: small
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 4. Dépend du ticket « contrat de ticket structuré ».

## Contexte
reviewer vérifie la fidélité au plan, pas l'atteinte de l'objectif. Le verifier de GSD contrôle « l'objectif, pas seulement le passage des tests » ; converge de Spec Kit classe les écarts (manquant / partiel / contradictoire / non demandé).

## Critères d'acceptation
- reviewer produit une ligne par critère d'acceptation : satisfait / partiel / manquant, avec preuve (fichier:ligne, test, sortie de commande).
- Tout critère non prouvé donne `changes-requested`.
- Les ajouts non demandés par le ticket sont signalés.
- Test de contrat sur le prompt (tests/agents-*).
