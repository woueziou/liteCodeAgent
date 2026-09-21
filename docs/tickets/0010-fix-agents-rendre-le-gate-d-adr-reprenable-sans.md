---
schemaVersion: 1
id: 0010-fix-agents-rendre-le-gate-d-adr-reprenable-sans
title: fix(agents): rendre le gate d'ADR reprenable sans reconstruction manuelle
label: bug
status: backlog
priority: medium
size: medium
assignedAgent: implementer
dueDate: 
issue: 28
synced: true
syncedAt: 2026-09-18T17:34:18.974Z
---

## Symptôme observé

Un `implementer` qui s'arrête sur `STATUS: adr-pending-approval` n'est **pas reprenable**. Quand l'humain approuve l'ADR, la tentative de reprise de l'agent échoue avec :

```
could not be resumed: No transcript found for agent ID: <id>
```

Il faut alors relancer un `implementer` neuf et **lui reconstruire son état à la main** dans le prompt d'invocation : chemin du worktree, nom de branche, sha du commit déjà présent, fichier d'ADR non tracké, statut du board déjà positionné, résultat des vérifications déjà passées, et le fait que l'ADR a déjà été posté en commentaire et ne doit pas l'être deux fois.

## Occurrences constatées (session du 18/09/2026)

Deux fois dans la même journée, sur deux tickets différents :

1. Issue #10 (tampon de tickets local) — worktree `../worktrees/issue-10`, branche `feat/local-ticket-buffer/issue-10`, commit `e3b72e9`, ADR 0001 non tracké.
2. Issue #17 (prévérification des chemins de config) — worktree `../worktrees/issue-17`, branche `fix/preflight-config-paths/issue-17`, commit `9dbefb8`, ADR 0006 non tracké.

Dans les deux cas le travail était intact sur disque ; seule la continuité de l'agent était perdue.

## Pourquoi ça compte

L'étape 5 de la section « ADR draft approval gate » de `packs/core/agents/implementer.md` dit : « If you're resumed specifically to continue past this gate, treat the human's message as that approval ». Ce chemin **suppose une reprise qui n'est pas fiable en pratique**. Le prompt décrit donc un mécanisme sur lequel le flux ne peut pas compter.

Le recollage manuel n'est pas qu'inconfortable, il est fragile : l'état est reconstruit de mémoire par la session appelante, et tout élément oublié (par exemple « l'ADR a déjà été posté, ne le reposte pas ») produit un doublon ou une action répétée. C'est la même classe de problème que la double création d'issue corrigée dans le tampon de tickets — un état qui n'est pas persisté est un état qu'on rejoue mal.

## Cause racine probable, et ce qui est réellement corrigeable ici

La non-reprise vient vraisemblablement du harness qui héberge les sous-agents, pas du code de ce repo : l'agent et son transcript sont éphémères. Il ne faut donc pas promettre dans le ticket une correction de la reprise elle-même.

Ce qui est corrigeable ici, c'est de **rendre la reprise inutile** : l'état nécessaire pour continuer doit être écrit quelque part de durable au moment du gate, plutôt que de vivre dans la tête d'un agent disparu.

Pistes à évaluer (à trancher à l'implémentation, pas pré-décidées) :

- Un manifeste de reprise écrit par `implementer` au moment du gate — worktree, branche, sha, chemin de l'ADR, actions déjà effectuées (ADR posté en commentaire, statut du board déjà changé, vérifications déjà passées) — dans un fichier versionné ou dans le commentaire d'issue lui-même, et relu par l'agent qui reprend.
- Faire du commentaire d'ADR déjà posté sur l'issue le porteur de cet état, puisqu'il est déjà écrit et durable.
- Réécrire l'étape 5 de `implementer.md` pour qu'elle décrive une reprise **par reconstruction depuis l'artefact durable**, et non une continuité de conversation, avec les actions idempotentes explicitement listées (ne pas reposter l'ADR, ne pas recréer la branche, ne pas rebouger le board).
- Vérifier s'il existe un cas symétrique côté `reviewer` ou `triage`.

## Critère d'acceptation

Un humain qui approuve un ADR doit pouvoir faire continuer le travail **sans que la session appelante ait à réécrire l'état à la main**, et sans risque de rejouer une action déjà faite.

## Notes

Aucun ADR n'est a priori nécessaire pour ce ticket ; si l'implémenteur juge qu'il en faut un, les numéros 0003, 0004, 0005 et 0006 sont déjà réservés ou pris — prendre le prochain libre au moment de l'implémentation.

<!-- litecode:comment -->
PR #39 (https://github.com/woueziou/liteCodeAgent/pull/39) implements this ticket: `packs/core/agents/implementer.md`'s ADR draft approval gate now writes a durable `resume-manifest` fenced block into the same ADR-draft comment, and step 5 reconstructs mechanically from that artifact on resume instead of relying on session memory. ADR 0008 documents the decision. Rendered `.claude/`/`.kilo/` copies and lock files updated via `bun run src/cli.ts install --apply`.

`reviewer` ran three passes on this PR across the implementation run:

1. Pass 1: `changes-requested` — flagged that step 5 never said what to do if the resume-manifest comment is missing/malformed/ambiguous, or if its `commit` sha can't be found in `git log`. Fixed same-PR (commit 3e59238): added explicit escalate-to-`triage` guidance for those cases.
2. Pass 2: `changes-requested` — found two bugs in that fix: (a) the resume-manifest markdown example used an invalid nested 3-backtick fence that a literal-minded implementer could reproduce, corrupting the artifact; (b) the new "commit not found → escalate" rule contradicted the manifest's own valid `commit: none` state (nothing committed yet, e.g. an ADR-only ticket), which would misfire as a false escalation. Fixed same-PR (commit 77fa799): widened the outer fence to 4 backticks, added an explicit `commit: none` carve-out.
3. Pass 3 (final, on commit 77fa799): manually confirmed both fixes are correct (fence nesting verified against CommonMark rules, `commit: none` carve-out text present and unambiguous, rendered copies match source) and found no new issues. **Verdict capped at `changes-requested` solely because the `code-review` correctness/simplification sub-pass it launches did not return within the turn budget on all three passes** — reviewer's own protocol treats a sub-pass that doesn't come back as incomplete rather than substituting a manual read in its place, so it would not issue `approve`/`approve-with-notes` without that sub-pass actually completing.

REENTRY per reviewer pass 3: no manual findings remain outstanding; re-run `reviewer` (or invoke the `code-review` skill directly and wait for it to actually complete) before merging — if it comes back clean this should convert straight to `approve`/`approve-with-notes` with no further code changes expected.

`bun run check` (tsc --noEmit) and `bun test` (119 pass / 0 fail) both pass as of the latest commit (77fa799).

Moving this to `Review` rather than `Ready to Merge` since the verdict in hand is `changes-requested`, even though the blocking factor is a reviewer-side sub-pass availability issue rather than a defect in this diff.
<!-- /litecode:comment -->
