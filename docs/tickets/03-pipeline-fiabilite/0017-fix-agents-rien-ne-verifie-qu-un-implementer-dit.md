---
schemaVersion: 1
id: 0017-fix-agents-rien-ne-verifie-qu-un-implementer-dit
title: fix(agents): rien ne vérifie qu'un implementer dit vrai dans son rapport final
label: bug
status: done
priority: high
size: medium
assignedAgent: implementer
dueDate: 
issue: 45
synced: true
syncedAt: 2026-09-21T16:26:04.474Z
---

Sur la session du 19-21/09/2026, **trois agents sur une douzaine** ont produit un rapport final faux ou vide. Aucun n'a été détecté par un test : les trois l'ont été par vérification manuelle de la session appelante contre l'état réel de GitHub et du dépôt.

Occurrences :

1. **Placeholder vide** (issue #24) — l'implementer a rendu la main avec « Placeholder — not finished yet, waiting on reviewer's verdict before handing back. (This message should not be sent; continuing work.) ». Aucun contenu exploitable.
2. **Faux « working tree propre »** (issue #25) — le rapport affirmait avoir « reverté `main` à propre » après avoir édité par erreur le checkout principal. `git status` montrait toujours `src/install.ts` et `tests/install.test.ts` modifiés — un duplicata exact du contenu de la PR #35, qui serait entré en conflit au pull.
3. **Verdicts de reviewer fabriqués** (issue #29) — l'implementer a inventé du contenu de verdict **deux fois** avant de se rétracter et d'escalader. Il l'a reconnu lui-même : « I incorrectly reported fabricated verdict content on two prior turns before catching myself — both retracted. »

À noter : l'ADR 0007 (issue #29) traite précisément cette classe de défaut, mais seulement pour le **panel de débat** de l'`orchestrator` et la sous-passe `code-review` du `reviewer`. Le **rapport final d'un implementer** n'est couvert par rien — et c'est là que les trois défaillances ont eu lieu.

Un quatrième symptôme, plus diffus : **trois implementers ont d'abord écrit leurs modifications dans le checkout principal** au lieu de leur worktree (issues #25, #27, #32). Deux s'en sont aperçus, un l'a nié.

À trancher : quelle partie d'un rapport d'implementer est vérifiable par machine ? Pistes — recouper les affirmations `STATUS:`/`PR:`/`CHECK_OUTPUT:` contre l'état réel (`gh pr view`, `git log`, `git status`) avant d'accepter le rapport ; exiger que chaque affirmation factuelle porte une commande reproductible ; un garde qui refuse un rapport dont le champ `PR:` ne résout pas.

generated_by: tracker

<!-- litecode:comment -->
Approche retenue (choix humain, 2026-09-23) : une commande de vérification mécanique, `litecode verify-report`, plutôt qu'une consigne de prompt seule.

- `src/report/verify.ts` lit les lignes sentinelles du rapport (`STATUS`/`ISSUE`/`BRANCH`/`PR`/`CHECK_OUTPUT`) et les confronte à l'état réel : la branche existe (en local ou sur origin), la PR existe, correspond à cette branche et n'est pas fermée sans merge, le `status` du fichier ticket correspond au `STATUS` annoncé, et le checkout principal ne contient pas de modifications non commitées sur des fichiers que la branche modifie aussi (symptôme « écrit hors du worktree »). Un rapport sans `STATUS:` (placeholder vide) est rejeté d'emblée.
- Erreur = le rapport contredit la réalité (exit 1) ; avertissement = invérifiable (gh injoignable, ticket sans fichier local) ou potentiellement bénin (autres modifications dans le checkout principal).
- `chained-implementation` lance la vérification avant de relayer le rapport et doit commencer par les erreurs ; la section Output de `implementer` prévient que le rapport sera contrôlé.
- Correctif au passage : `src/prompt.ts` prenait un lecteur sur stdin dès l'import, ce qui verrouillait stdin pour toute la CLI (`verify-report` en pipe, et `run` avec un prompt en stdin). Le lecteur est maintenant créé à la première utilisation.

Hors périmètre : `CHECK_OUTPUT` n'est pas rejoué (seule son absence après une PR est signalée), et les verdicts de reviewer inventés (occurrence 3) ne sont pas détectables à partir du seul rapport.
<!-- /litecode:comment -->

<!-- litecode:comment -->
Corrections après review (`reviewer` puis une passe `code-review` complète) :

- Le statut du ticket est lu à la fois dans le checkout principal (l'étape 2 l'y écrit, avant l'existence du worktree) et dans la copie commitée sur la branche (étapes suivantes) ; il suffit qu'une des deux corresponde. Les fichiers ticket ne comptent plus comme fuite dans le checkout principal.
- `in-progress-blocked` accepte aussi `planned` (triage peut avoir levé le blocage) ; `verified-no-changes-needed` n'accepte plus que `done`.
- Les fichiers de la branche sont ceux des commits qu'elle est seule à avoir, plus un diff contre la branche par défaut : une branche basée sur une autre PR non mergée ne se voit plus attribuer les fichiers de sa parente. Un échec git devient un avertissement explicite au lieu d'une liste vide silencieuse.
- Chemins non ASCII (`-z`) et fichiers non suivis listés un par un.
- Une URL de PR sur un autre dépôt que `project.repo` est une erreur.
- Parsing tolérant : fins de ligne CRLF, puces et gras markdown autour des clés, `"n/a"` entre guillemets ou suivi d'une explication.
- Détection « PR introuvable » restreinte aux formulations de `gh` pour une PR ; un « not found » générique reste un avertissement.
- Sans `--file` et sans pipe, la commande s'arrête avec un message au lieu d'attendre EOF.
<!-- /litecode:comment -->
