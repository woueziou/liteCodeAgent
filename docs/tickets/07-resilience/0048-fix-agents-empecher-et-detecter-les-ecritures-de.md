---
schemaVersion: 2
id: 0048-fix-agents-empecher-et-detecter-les-ecritures-de
title: "fix(agents): empêcher et détecter les écritures de source dans le checkout principal"
label: bug
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
---

## Contexte
Deux fois déjà, le travail d'une branche de ticket est apparu en copie non commitée dans le checkout principal : ticket 0032 (autre session, fichiers src/dashboard/*) et ticket 0045 (packs/core/agents/{implementer,reviewer,bug-hunter}.md et un test, identiques à la PR #83). La seconde a fait échouer `verify-report` pour le ticket 0034, qui travaillait en parallèle sur implementer.md. Cause probable : un sous-agent (étape déléguée, reviewer ou bug-hunter) démarre dans le checkout principal et y écrit, faute de chemin absolu vers le worktree.

## Critères d'acceptation
- implementer passe systématiquement le chemin absolu de son worktree à chaque sous-agent qui peut écrire, avec l'interdiction explicite d'écrire ailleurs ; reviewer et bug-hunter n'écrivent jamais de fichier suivi par git.
- Avant de rendre son rapport, implementer vérifie `git status` du checkout principal : toute modification d'un fichier que sa branche touche est signalée, et nettoyée si elle est identique octet pour octet à sa branche.
- `litecode doctor` signale une modification non commitée du checkout principal identique au contenu d'une branche de ticket ouverte (fuite probable), en nommant la branche.
- Tests : doctor détecte une fuite simulée ; test de contrat sur le prompt implementer.

## Plan
1. packs/core/agents/implementer.md : consignes de délégation et vérification de fin de run ; régénérer les agents.
2. src/doctor.ts : nouveau check « fuite dans le checkout principal ».
3. tests/doctor.test.ts, tests/agents-*.

## Hors périmètre
Sandbox des outils d'écriture par agent (non disponible dans les harnesses cibles).
