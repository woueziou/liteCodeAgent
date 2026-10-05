---
schemaVersion: 2
id: 0081-perf-implementer-passer-le-relais-apres-l-ouvert
title: "perf(implementer): passer le relais après l'ouverture de la PR à un agent au contexte vierge"
label: feature
status: inProgress
priority: high
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Mesuré : dans le run du ticket 0069, l'implementer garde tout son contexte de code (jusqu'à 174 000 tokens) pendant toute la fin du run — attente de la CI, lancement et postage des relectures, déplacements de statut, notes — alors que cette partie n'a plus besoin de ce contexte. Chaque appel de cette fin de run relit ce contexte inutilement : c'est le plus gros poste de consommation de l'implementer. La règle « une PR par ticket, un rapport final » ne doit pas changer.

## Critères d'acceptation
- Un ADR (`docs/decisions/`) décrit la décision et est validé par l'humain avant l'implémentation (marqueur `## ADR à valider` dans le ticket, comme le flux existant) : ce qui est transmis (ticket, PR, branche, chemin du worktree, verdicts), ce qui reste chez l'implementer, et le comportement en cas d'échec.
- Après le push de la PR, l'implementer lance un agent au tier `fast` qui gère : attente de la CI, `reviewer`/`bug-hunter`, postage des rapports, déplacement de statut, note de ticket, et renvoie le rapport final.
- Si les relectures demandent des corrections, l'agent relais le remonte à l'implementer, qui corrige puis relance le relais : jamais deux agents qui écrivent dans le même worktree en même temps.
- Le rapport final vu par l'humain garde le même format ; `litecode verify-report` passe inchangé.
- `implementer.md` reste sous son budget de taille ; le nouvel agent ou la nouvelle référence respecte le budget de mots des descriptions.
- Mesure avant/après avec `litecode token-report` sur un ticket de taille comparable, consignée dans le ticket.
- `bun run check` et `bun test` passent.

## Plan
1. Écrire l'ADR et le soumettre à l'humain.
2. Après validation : créer l'agent relais (ou une référence lue par un agent générique au tier fast) et brancher l'étape 8 à 10 de l'implementer dessus.
3. Adapter les tests du flux de relecture et de `verify-report`.
4. Mesurer avant/après et consigner.

## Hors périmètre
Modifier le contenu des relectures ; fusionner `reviewer` et `bug-hunter`.

## ADR à valider : 0027

L'ADR est rédigé : `docs/decisions/0027-hand-the-tail-of-an-implementer-run-to-a-fresh-context-closer.md` (statut `proposed`). Le fusionner vaut validation ; il pose cinq questions à la fin. Aucun code n'est écrit avant.

Mesure faite pour l'ADR (la prémisse du ticket reposait sur un seul run) : sur 42 runs réels d'implementer avec une PR, la part du contexte lu après `gh pr create` est de 55,8 % en moyenne (médiane 55,0 %, de 22,6 % à 95,4 %). Méthode et script : `docs/specs/restructure-baseline/tail-share.py`.

## Avancement (2026-10-05)

Livré, **désactivé par défaut** (ADR 0027, décision 8) : le réglage `project.handoff`, la table des capacités (vide), l'agent `closer` au niveau `fast`, le texte de relais de l'implementer, le marqueur de journal et la protection de `litecode resume`. Avec la config par défaut, le rendu de tous les agents est identique octet pour octet à celui d'avant (454 sorties comparées contre le commit de base).

Reste, pour clore le ticket (ADR 0027, décision 9) :
- la mesure avant/après sur de vraies PR (dépôt GitHub jetable, au moins cinq runs par condition, `litecode token-report --detail`, méthode du ticket 0090) ;
- si la part du contexte lu après la PR baisse d'au moins un quart, sans nouvel échec de `verify-report` : ajouter `claude-code` à la table et passer le défaut à `auto`.

Non vérifié de bout en bout : la chaîne implementer, closer, reviewer sur Claude Code. Les transcripts montrent des sous-agents jusqu'à la profondeur 3 dans ce projet, mais pas ce parcours précis.
