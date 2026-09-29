---
schemaVersion: 2
id: 0061-perf-agents-proportionner-le-flux-d-implementati
title: "perf(agents): proportionner le flux d'implémentation à la taille du ticket et alléger implementer.md"
label: feature
status: planned
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesures du 2026-09-28/29 (tokens déclarés par chaque implémenteur) : 80 k à 190 k par ticket, médiane ~135 k, avant réviseurs ; +70 à 150 k à chaque reprise après un ADR. Le 0044 (correction d'une expression régulière de quelques lignes) a coûté ~84 k, autant qu'une feature medium. Causes identifiées :
- `packs/core/agents/implementer.md` fait ~7 400 mots (~10 k tokens), 3x reviewer et 8x bug-hunter, rechargé à chaque exécution et chaque reprise ; il a grossi d'une règle à chaque incident (fuites, push forcé, CI, ADR, journal, isolation), dont la plupart ne servent que dans des cas rares.
- Le flux est le même pour tous les tickets : un small passe par worktree, PR, CI, reviewer, bug-hunter en tier `reasoning` (le plus cher), souvent une re-chasse puis une seconde relecture. Le classifier fait sauter le débat aux tickets triviaux, rien n'allège l'implémentation.

## Critères d'acceptation
- implementer.md garde dans son corps le flux nominal seulement ; les cas rares (porte d'ADR et reprise, panne GitHub, découpage en étapes des tickets medium/large, reprise de fixup, PR empilée, nettoyage d'une fuite) passent dans des skills du pack core chargés uniquement quand le cas se présente. Objectif : corps d'implementer.md ≤ 3 000 mots, sans perdre aucune règle (chaque règle retirée du corps est retrouvable dans un skill, et un test le vérifie).
- Flux proportionné à `size`, écrit dans implementer.md et reviewer.md :
  - `small` : bug-hunter en tier `balanced` ; pas de re-chasse sauf finding bloquant ; pas de seconde relecture du reviewer pour des corrections non bloquantes.
  - `medium`/`large` : flux actuel.
  - Le tier se choisit à l'appel (le prompt de délégation le demande) sans dupliquer les agents ; si la cible ne permet pas de choisir le modèle à l'appel, documenter et garder le tier par défaut.
- Les consignes que l'appelant répète à chaque lancement (worktree, commits de ticket, CI, pas de push forcé, un seul rapport final) sont déjà dans implementer.md : le skill chained-implementation et la doc disent de ne passer que le ticket et les spécificités du lancement.
- Tests : taille du corps d'implementer.md bornée ; chaque skill extrait référencé et installé ; test de contrat du flux par taille ; agents installés régénérés.
- ADR : décision sur le flux proportionné à la taille.

## Plan
1. packs/core/skills/ : nouveaux skills pour les cas rares ; packs/core/agents/implementer.md allégé.
2. implementer.md, reviewer.md, bug-hunter.md : flux par taille ; src/delegation.ts si le tier par appel nécessite un helper.
3. packs/core/skills/chained-implementation : prompt de lancement minimal.
4. tests/ + `install --apply`.

## Hors périmètre
Mesure des tokens (ticket séparé) ; changer les modèles des tiers.
