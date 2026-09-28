---
schemaVersion: 2
id: 0047-feat-adr-rendre-visibles-sur-main-les-adr-en-att
title: "feat(adr): rendre visibles sur main les ADR en attente d'approbation"
label: feature
status: readyToMerge
priority: high
size: medium
assignedAgent: human
dueDate: 
---

## Contexte
La porte d'approbation ADR (implementer, ADR 0008) interdit de commiter un ADR avant l'accord humain : le fichier reste dans le worktree du ticket, et seule une copie du texte arrive sur `main`, noyée dans une note du ticket. L'écran ADR du dashboard (0032) ne lit que `docs/decisions/`. Rien ne signale qu'un ADR attend une validation ni où le lire. Constaté le 2026-09-28 avec l'ADR 0018 (ticket 0034) : le propriétaire ne le trouvait pas pour le valider.

## Critères d'acceptation
- Le dashboard liste les ADR en attente d'approbation (statut « à valider »), avec leur texte complet et le ticket concerné. Ils sont détectés depuis les notes de ticket portant un `resume-manifest` avec `adr_path` dont le fichier n'existe pas encore dans `docs/decisions/`.
- `litecode doctor` et `litecode ticket list` signalent un ticket bloqué sur un ADR en attente, avec le chemin du ticket où le lire.
- implementer, à la porte ADR, écrit le brouillon dans une section dédiée du ticket (`## ADR à valider : NNNN`) plutôt qu'au milieu d'une note, et donne ce chemin dans son rapport.
- Une fois l'ADR commité (après approbation), il n'apparaît plus comme « à valider ».
- Tests : détection d'un brouillon en attente, disparition après commit, affichage dashboard.

## Plan
1. src/decisions/ : lecture des brouillons depuis les tickets (réutiliser src/report/journal.ts du ticket 0034 s'il est fusionné).
2. Dashboard : section « ADR à valider ».
3. src/doctor.ts et `ticket list` : signalement.
4. packs/core/agents/implementer.md : section dédiée dans le ticket ; régénérer les agents.

## Hors périmètre
Commiter les brouillons d'ADR sur main (écarté : l'ADR précéderait son code et devrait être supprimé en cas de refus).

### 2026-09-28 — implementer: PR ouverte, reviewer + bug-hunter passés, Ready to Merge

PR : https://github.com/woueziou/liteCodeAgent/pull/89 (branche `feat-adr-visible-pending/0047`, base `main`).

Implémentation : `src/decisions/pending.ts` (nouveau — détection des brouillons ADR en attente, réutilise `parseJournalEntries` de `src/report/journal.ts` en import seulement, sans le modifier), `src/dashboard/build.ts` + `src/dashboard/render-adrs.ts` + `src/dashboard/render.ts` (section « ADR en attente d'approbation » sur l'écran ADR), `src/doctor.ts` (nouveau finding `checkPendingAdrDrafts`), `src/cli.ts` (`ticket list` signale la ligne d'avertissement), `packs/core/agents/implementer.md` (porte ADR : brouillon écrit dans une section dédiée `## ADR à valider : NNNN`, agents installés régénérés).

`reviewer` : **approve**, aucun finding bloquant, fidélité au plan confirmée (aucune modification de `src/report/journal.ts`, `src/resume.ts`, `src/report/probes.ts`, conformément à la contrainte de parallélisme avec le ticket 0049 ; diff `implementer.md` confiné à la section de la porte ADR).

`bug-hunter` (1er passage) : **1 finding bloquant** — `listPendingAdrs` ne redevenait jamais « non en attente » une fois l'ADR approuvé et le gate repris (l'ADR est commité sur la branche du ticket, pas immédiatement visible sur `root`), tant qu'aucune note de journal postérieure sans `adr_path` n'existait. Corrigé (commit `1638229`) : seule la toute dernière entrée de journal (peu importe sa forme) détermine l'état « en attente » — une note `progress-journal` postérieure sans `adr_path` fait sortir le ticket de la liste. Findings non bloquants également corrigés dans le même commit : indentation du fence `resume-manifest` tolérée, texte après le numéro dans le heading toléré, normalisation NFC pour un « à » décomposé, id HTML du dashboard namespacé par ticket pour éviter les collisions.

`bug-hunter` (2e passage, sur le fixup) : **HUNT: complete**, 0 finding bloquant. Un finding non bloquant restant (la nouvelle regex du heading avalait la ligne suivante en l'absence de ligne vide après le heading) a été corrigé dans un fixup supplémentaire (commit `39a56bd`, `bun run check` et `bun test` re-vérifiés, 356 tests passent). Un dernier finding non bloquant (un heading avec un suffixe collé sans espace donne `text: null`, dégradation visible et non silencieuse) est volontairement laissé ouvert, comme convenu avec `bug-hunter`.

Hors périmètre de cette PR, signalé par `bug-hunter` comme faiblesses préexistantes de `src/report/journal.ts` (partagé avec `litecode resume`), à traiter via `triage`/nouveau ticket si jugé utile par un humain :
- un `resume-manifest` cité à titre d'exemple dans un fence de documentation à l'intérieur d'un corps de ticket est compté comme un brouillon réellement en attente (parsing non conscient des fences imbriquées) ;
- un corps de ticket en CRLF n'est pas détecté par la regex `BLOCK` de `journal.ts` (elle exige `\n` immédiatement après ```` ```resume-manifest ````).

Les trois verdicts complets (`reviewer` approve, `bug-hunter` 1er passage avec le finding bloquant, `bug-hunter` 2e passage HUNT: complete) sont postés verbatim sur la PR #89.

`bun run check` et `bun test` (356 pass, 0 fail) exécutés dans le worktree avant l'ouverture de la PR et après chaque fixup.

Statut : `In Progress` → `Ready to Merge`.
