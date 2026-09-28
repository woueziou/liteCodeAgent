---
schemaVersion: 2
id: 0043-feat-agents-planner-et-tracker-posent-a-clarifie
title: "feat(agents): planner et tracker posent [À CLARIFIER] sur les questions ouvertes"
label: feature
status: planned
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Finding non bloquant de bug-hunter sur la PR #80 (ticket 0035). `ticket move` refuse le passage en planned tant que `[À CLARIFIER]` est présent, mais aucun agent n'émet ce marqueur : le blocage existe sans que le flow ne l'alimente jamais. Une question restée ouverte dans le débat (synthesizer `unresolved-tension`, hypothèse non vérifiée du planner) arrive donc dans le ticket comme une affirmation.

## Critères d'acceptation
- planner signale explicitement ses questions ouvertes (ligne dédiée dans sa sortie) au lieu de les trancher.
- tracker écrit chaque question ouverte reçue dans le corps du ticket, préfixée par `[À CLARIFIER]`, dans la section concernée.
- Le skill idea-to-planned s'arrête proprement quand le ticket créé porte le marqueur (dispatcher ne peut pas le planifier) et le dit à l'humain.
- triage, qui a déjà le droit de retirer le marqueur, reste la seule voie de sortie avec l'humain.
- Tests de contrat sur les prompts (tests/agents-*), agents installés régénérés.

## Plan
1. packs/core/agents/planner.md : ajouter une sortie `OPEN_QUESTIONS:`.
2. packs/core/agents/orchestrator.md : relayer `OPEN_QUESTIONS` tel quel.
3. packs/core/agents/tracker.md : écrire les questions avec le marqueur.
4. packs/core/skills/idea-to-planned/SKILL.md : gérer le refus de ticket move.
5. Tests + `install --apply`.

## Hors périmètre
Détecter automatiquement des questions dans du texte libre.
