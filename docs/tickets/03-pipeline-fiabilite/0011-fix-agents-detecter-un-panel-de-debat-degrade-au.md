---
schemaVersion: 1
id: 0011-fix-agents-detecter-un-panel-de-debat-degrade-au
title: fix(agents): détecter un panel de débat dégradé au lieu de rendre un plan silencieusement affaibli
label: bug
status: done
priority: high
size: medium
assignedAgent: implementer
dueDate: 
issue: 29
synced: true
syncedAt: 2026-09-18T17:34:29.397Z
---

## Symptôme observé

`orchestrator` rend un plan d'apparence normale alors qu'une partie de son panel ne lui est jamais parvenue de façon lisible. Le plan sort avec une classification et une synthèse, mais celles-ci sont en réalité **les siennes**, pas celles des agents dédiés — et rien dans le format de sortie ne le signale structurellement.

## Occurrences constatées (session du 18/09/2026)

**Occurrence 1** — orchestration du chantier « regrouper l'état dans `.litecodeagent/` ». L'orchestrateur l'a signalé de lui-même, en note libre en fin de rapport :

> les hand-backs de `classifier` et `panel-selector` ne lui sont pas parvenus sous forme lisible, donc le calibrage « large » et les deux angles débattus (correctness, contract) étaient sa propre sélection plutôt que le routage verbatim de ces agents ; le rapport de l'angle `contract` n'a de même atteint le `synthesizer` que sous forme de sa paraphrase.

**Occurrence 2** — ticket #17, constatée à l'implémentation et consignée dans l'ADR 0006 :

> the planning panel that produced this ticket was degraded (the classifier's verdict was unreadable, and 2 of 3 debate angles were lost), so this decision rests on direct code inspection during implementation rather than a full debate.

Deux fois dans la même journée, sur deux chantiers sans rapport.

## Pourquoi c'est grave

Le débat contradictoire est la valeur même de cette pipeline. Un panel à un seul angle réel qui se présente comme un panel à trois produit un plan **qui inspire une confiance qu'il n'a pas méritée**, et cette confiance est ensuite consommée en aval : le ticket est rédigé, l'implémenteur l'exécute, et l'ADR qui en découle hérite d'une décision jamais réellement contestée.

Dans les deux occurrences, la dégradation n'a été rattrapée que parce qu'un agent a eu l'honnêteté de la mentionner en prose libre. Ça ne peut pas rester le mécanisme de détection : c'est du volontariat, pas un garde-fou. Un panel dégradé qui ne se signale pas passe totalement inaperçu.

## Cause racine probable, et ce qui est réellement corrigeable ici

La perte elle-même vient vraisemblablement du relais des rapports de sous-agents dans le harness, pas du code de ce repo. Le ticket ne doit donc pas promettre de fiabiliser ce transport.

Ce qui est corrigeable ici, c'est de **rendre la dégradation impossible à ignorer** : aujourd'hui l'échec est silencieux et le résultat reste d'apparence normale, ce qui est le pire des deux mondes.

Pistes à évaluer (à trancher à l'implémentation, pas pré-décidées) :

- Ajouter au format de sortie d'`orchestrator` un champ obligatoire de provenance — quels agents ont réellement répondu, lesquels ont été suppléés par l'orchestrateur lui-même — sur le modèle des lignes sentinelles existantes (`SIZE:`, `BLOCKING_TENSION:`, `ADR:`). La clé reste en anglais comme toutes les sentinelles.
- Faire d'un panel incomplet un état explicite et non un détail de prose : par exemple un `PANEL: complete` / `PANEL: degraded (<détail>)`, que la session appelante doit relayer à l'humain.
- Envisager une nouvelle tentative sur l'angle perdu avant de rendre un plan, quand c'est un angle et non le classifier qui manque.
- Vérifier le cas symétrique : `synthesizer` recevant la paraphrase d'un angle au lieu de son rapport, et `reviewer` dont une sous-passe `code-review` n'a pas rendu dans son budget de tour — déjà observé aujourd'hui sur la PR #11.

## Décision du propriétaire : garde-fou, pas signalement

L'arbitrage « bloquer ou seulement s'annoncer » est **tranché : un panel dégradé bloque.**

Un signalement en prose est du volontariat — il n'a fonctionné dans les deux occurrences ci-dessus que parce qu'un agent a pensé à le mentionner, et c'est précisément ce qu'il faut cesser d'espérer. La condition d'arrêt doit être structurelle :

- `orchestrator` ne rend pas un plan exploitable quand un agent du panel n'a pas répondu de façon lisible ; il rend un état d'échec explicite.
- Aucun ticket n'est créé à partir d'un plan dont le panel est incomplet.
- Un humain peut passer outre, mais **explicitement** et en connaissance de cause — jamais par défaut, jamais par omission.

L'orchestrateur ne doit en particulier plus se substituer silencieusement à un agent manquant : suppléer `classifier` ou un angle de débat et présenter le résultat comme celui du panel est le comportement à supprimer, pas à documenter.

## Précédent interne

La même leçon a déjà été apprise ailleurs dans ce repo, dans un autre domaine : `project.lessons` retient que `gh api graphql -f name=value` envoyait tout en chaîne, et que l'échec est passé à travers toutes les versions jusqu'à 0.9.0 **parce qu'aucun test ne regardait le corps de la requête**. Ici c'est le même motif : personne ne regarde ce qui est réellement arrivé du panel, seulement ce qui en ressort.

## Critère d'acceptation

Un panel incomplet doit être visible **sans dépendre du fait qu'un agent pense à le mentionner**, et l'humain doit le voir avant qu'un ticket ne soit créé à partir de ce plan.

## Notes

Ce ticket touche vraisemblablement `packs/core/agents/orchestrator.md`, `packs/core/agents/synthesizer.md` et `packs/core/agents/panel-selector.md`. Un ADR est plausible vu qu'il faut trancher « bloquer ou signaler » — les numéros 0003 à 0006 sont déjà réservés ou pris, prendre le prochain libre au moment de l'implémentation.

generated_by: tracker
