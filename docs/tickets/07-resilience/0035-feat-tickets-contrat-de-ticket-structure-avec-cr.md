---
schemaVersion: 2
id: 0035-feat-tickets-contrat-de-ticket-structure-avec-cr
title: "feat(tickets): contrat de ticket structuré avec critères d'acceptation"
label: feature
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 3.

## Contexte
Le corps d'un ticket est du texte libre, et la sortie PLAN: de l'orchestrator n'est pas recopiée dans le ticket créé par tracker : le plan débattu peut se perdre. Spec Kit (spec.md + [NEEDS CLARIFICATION]) et GSD (REQUIREMENTS.md, REQ-IDs) structurent ce contrat.

## Critères d'acceptation
- Sections attendues dans le corps : Contexte, Critères d'acceptation, Plan, Hors périmètre.
- tracker recopie verbatim le PLAN et les REQUIREMENTS de l'orchestrator.
- `ticket doctor` signale un ticket planned/inProgress sans critères d'acceptation.
- Un marqueur `[À CLARIFIER]` (ou équivalent configurable) empêche le passage à planned (dispatcher + ticket move).
- `docs/tickets/README.md` documente le format ; les tickets existants (tous done) ne sont pas migrés.
