---
schemaVersion: 2
id: 0039-chore-tests-rejouer-des-sessions-enregistrees-po
title: "chore(tests): rejouer des sessions enregistrées pour tester les contrats des agents"
label: chore
status: planned
priority: low
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

Source : audit du 2026-09-27, point 7.

## Contexte
Le comportement des prompts n'est vérifié que par des assertions de chaînes sur les templates. Aucun test ne confronte les contrats de sortie (STATUS:, PANEL:, HUNT:, VERDICT…) à de vraies réponses de modèle.

## Critères d'acceptation
- Des fixtures enregistrées via `litecode run --record` pour orchestrator, implementer (rapport), reviewer et bug-hunter.
- Un test rejoue ces fixtures et valide les contrats de sortie avec les parseurs existants (verify-report, etc.).
- Procédure documentée pour ré-enregistrer une fixture quand un prompt change.
