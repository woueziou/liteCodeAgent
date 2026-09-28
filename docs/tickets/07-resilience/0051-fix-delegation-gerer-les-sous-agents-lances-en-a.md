---
schemaVersion: 2
id: 0051-fix-delegation-gerer-les-sous-agents-lances-en-a
title: "fix(delegation): gérer les sous-agents lancés en arrière-plan au lieu de rendre un rapport intermédiaire"
label: bug
status: backlog
priority: high
size: small
assignedAgent: human
dueDate: 
---

## Contexte
`src/delegation.ts` affirme à chaque agent que « every delegation is blocking: wait for the other agent's result in the same turn ». Dans les versions actuelles de Claude Code, l'outil `Agent` lance le sous-agent en arrière-plan et rend la main tout de suite ; le résultat arrive plus tard par notification. Constaté 3 fois le 2026-09-28 (tickets 0045, 0041, 0043 : l'implémenteur a lancé reviewer et bug-hunter puis rendu un message « WAITING / not final » à la place de son rapport `STATUS:`). Le 0045 et le 0041 ont ensuite terminé sans jamais renvoyer de rapport final : l'appelant a dû vérifier la PR et le ticket à la main. L'implémenteur prend ce comportement pour une faute (implementer.md, étape 8) alors que c'est l'outil.

## Critères d'acceptation
- Le texte de délégation de la cible claude-code (et des cibles qui partagent ce comportement) décrit les deux cas : résultat dans le même tour, ou sous-agent en arrière-plan dont on attend la notification de fin avant de continuer.
- Un agent qui a lancé des sous-agents en arrière-plan ne rend jamais de rapport intermédiaire : il attend leurs résultats, puis rend un seul rapport final au format attendu (`STATUS:` pour implementer).
- implementer.md (étape 8 et règle associée) est aligné sur ce texte : lancer reviewer et bug-hunter ensemble reste la règle, et « attendre » veut dire attendre les deux notifications.
- Si l'agent se termine malgré tout sans rapport final, `verify-report` sur une sortie vide reste une erreur explicite (comportement actuel) ; le skill chained-implementation dit à l'appelant de vérifier alors PR, verdicts et ticket lui-même.
- Tests : rendu du texte de délégation par cible ; test de contrat sur implementer.md ; agents installés régénérés.

## Plan
1. src/delegation.ts : texte par cible.
2. packs/core/agents/implementer.md : étape 8 et règle « never end your run between invoking reviewer/bug-hunter ».
3. packs/core/skills/chained-implementation/SKILL.md : conduite à tenir sans rapport final.
4. tests/ + `install --apply`.

## Hors périmètre
Changer le fonctionnement de l'outil Agent de Claude Code.
