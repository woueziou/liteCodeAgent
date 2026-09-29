---
schemaVersion: 2
id: 0056-fix-agents-le-test-d-abord-ne-doit-jamais-exiger
title: "fix(agents): le test d'abord ne doit jamais exiger de réécrire l'historique"
label: bug
status: backlog
priority: high
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
La règle test d'abord (ticket 0037, `project.testFirst`) et l'interdiction du push forcé (implementer.md) se contredisent dès qu'un implémenteur oublie de commiter le test en premier et a déjà poussé. Le reviewer rend alors un finding bloquant (« aucun commit ne montre le test en échec ») dont la seule correction est de découper l'historique et de forcer le push. Constaté le 2026-09-29 sur trois PR :
- #95 (0044) et #98 (0046) : l'implémenteur a réécrit l'historique et poussé en force (`--force-with-lease`, événements head_ref_force_pushed à 11:07 et 11:13), en violation de sa règle ; bug-hunter avait examiné l'ancienne tête.
- #96 (0055) : l'implémenteur a refusé de forcer, le reviewer a maintenu son blocage, le ticket a fini en `review` et le propriétaire a dû accepter l'exception.

## Critères d'acceptation
- reviewer ne demande jamais de réécrire, découper ou squasher un historique déjà poussé. Un test d'abord manquant sur un historique poussé est signalé dans `TEST_FIRST:` comme non satisfait, non bloquant, avec la preuve que le test échoue aujourd'hui contre le code d'avant le correctif (vérifiée dans une copie jetable) ; le ticket peut alors aller en `readyToMerge` si tout le reste est satisfait.
- implementer écrit et commite le test en échec avant tout code de correction, et le vérifie avant son premier push (règle déjà présente : la rendre explicite comme étape bloquante avant le push).
- La règle « jamais de rebase ni de push forcé » s'applique même quand un relecteur le demande ; implementer l'écrit explicitement.
- `verify-report` ou `doctor` signale une PR dont l'historique a été poussé en force (événement GitHub head_ref_force_pushed), en avertissement.
- Tests de contrat sur reviewer.md et implementer.md ; agents installés régénérés.

## Plan
1. packs/core/agents/reviewer.md : règle TEST_FIRST non bloquante sur historique poussé.
2. packs/core/agents/implementer.md : test avant le premier push ; push forcé interdit même sur demande.
3. src/report/probes.ts + verify.ts (ou src/doctor.ts) : détection du push forcé.
4. tests/ + `install --apply`.

## Hors périmètre
Supprimer la règle test d'abord.
