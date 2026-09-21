---
schemaVersion: 1
id: 0017-fix-agents-rien-ne-verifie-qu-un-implementer-dit
title: fix(agents): rien ne vérifie qu'un implementer dit vrai dans son rapport final
label: bug
status: planned
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
