---
schemaVersion: 2
id: 0040-feat-tickets-les-flows-creent-et-remplissent-les
title: "feat(tickets): les flows créent et remplissent les épics"
label: feature
status: planned
priority: medium
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

Source : discussion du 2026-09-27 après l'audit de résilience.

## Contexte
Un épic n'est qu'un dossier `docs/tickets/NN-nom/` (ADR 0012 §2), créé à la main. Le frontmatter n'a pas de champ epic, `litecode ticket new` n'a pas d'option `--epic` et écrit toujours à la racine (cas du 0032), et aucun agent (orchestrator, planner, tracker, dispatcher) ne décide d'un épic. Les tickets 0033-0040 ont été rangés dans `07-resilience` à la main.

## Critères d'acceptation
- `litecode ticket new --epic <nom>` écrit dans `docs/tickets/<NN-nom>/` ; un nom sans préfixe reçoit le prochain `NN-` libre ; un épic existant est réutilisé (correspondance sur le nom sans préfixe).
- planner propose un épic (`EPIC:` dans sa sortie) quand un plan se découpe en plusieurs tickets liés, ou rattache à un épic existant pertinent ; tracker passe `--epic`.
- `ticket doctor` avertit (sans erreur) pour un ticket à la racine quand des épics existent.
- dispatcher et le dashboard continuent de fonctionner sur les deux dispositions.
- Tests pour `--epic` (nouvel épic, épic existant, préfixe automatique) et l'avertissement du doctor.

## Hors périmètre
Déplacer le 0032 : décision humaine séparée.
