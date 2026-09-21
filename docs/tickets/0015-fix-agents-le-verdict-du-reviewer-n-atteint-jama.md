---
schemaVersion: 1
id: 0015-fix-agents-le-verdict-du-reviewer-n-atteint-jama
title: fix(agents): le verdict du reviewer n'atteint jamais la PR sur le chemin Ready to Merge
label: bug
status: backlog
priority: high
size: small
assignedAgent: human
dueDate: 
issue: 43
synced: true
syncedAt: 2026-09-21T15:36:02.564Z
---

Constat reproduit **cinq fois sur cinq** dans la session du 19-21/09/2026, sur les PR #34, #36, #39, #41 et #42 : chacune a été approuvée par `reviewer`, et **aucune ne porte le moindre commentaire sur GitHub**. `gh pr view <n> --json comments` renvoie 0 pour les cinq.

Deux causes distinctes, toutes deux dans les prompts :

1. **Chemin `Review`** : `implementer.md` étape 9 demande de stager le verdict comme commentaire sur le ticket local. Il n'atteint donc GitHub qu'au prochain `sync` — le propriétaire qui ouvre la PR pour merger ne voit rien.
2. **Chemin `Ready to Merge`** : le prompt ne prévoit **aucune** trace. L'étape 9 ne demande de stager le verdict que lorsqu'on atterrit sur `Review`. Une PR approuvée proprement ne garde donc aucune preuve qu'une review a eu lieu, ni de ce qu'elle a trouvé.

Le cas #42 est explicite : l'implementer a justifié l'absence de commentaire en disant qu'un `approve-with-notes` sans finding ouvert va directement en `Ready to Merge` « sans étape Review, donc sans commentaire requis ». Il suivait correctement le prompt.

Conséquence : les huit passes de review de la PR #41, qui ont trouvé cinq bugs bloquants réels (race à l'écriture concurrente, ticket marqué « synced » avec un push de Status non résolu, `statusEdit()` avalant silencieusement une erreur…), n'ont laissé aucune trace consultable sur la PR.

Piste : le verdict doit être posté sur la PR (`gh pr comment`) sur les DEUX chemins, ou à défaut le staging local doit être suivi d'un `sync` avant que l'implementer rende la main. À trancher : est-ce compatible avec l'invariant « seul `sync` parle à GitHub » (ADR 0010) ? Un `gh pr comment` n'est pas une mutation du GitHub Project — la frontière mérite d'être explicitée.

generated_by: tracker
