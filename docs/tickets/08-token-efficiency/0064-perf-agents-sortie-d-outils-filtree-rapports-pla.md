---
schemaVersion: 2
id: 0064-perf-agents-sortie-d-outils-filtree-rapports-pla
title: "perf(agents): sortie d'outils filtrée, rapports plafonnés, relecture unique pour les petits tickets"
label: feature
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesure du 0063 (small, .gitignore + filtre) : implementer 46 k, reviewer 26 k, bug-hunter 19 k. Les agents lancent la suite complète (~570 tests) plusieurs fois, collent des `gh pr view --json` et des diffs entiers ; les rapports finaux font 1 à 2 k tokens que l'appelant relit ; reviewer.md fait ~2 200 mots.

## Critères d'acceptation
- implementer : tests ciblés pendant le travail, suite complète une fois avant le push ; sorties filtrées (résumé + échecs, `--json` avec `--jq`, `git diff --stat` avant tout diff complet).
- Rapport final d'implementer : bloc STATUS + 10 lignes au plus ; le détail va dans la note du ticket. `verify-report` inchangé.
- Tickets `chore`/`doc` sans changement sous `src/`, et `small` sans logique : une seule passe (reviewer en tier `fast` qui couvre aussi la chasse aux bugs), pas de bug-hunter.
- reviewer.md allégé comme implementer.md (ADR 0021) : cas rares en skills, budget de mots testé.
- Tests de contrat ; agents installés régénérés.

## Plan
1. packs/core/agents/implementer.md, reviewer.md, bug-hunter.md ; skills reviewer-*.
2. tests/ (budget de mots, flux par label/taille).
3. install --apply.

## Hors périmètre
Lots de tickets (ticket séparé).
