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
**DRAFT ADR — awaiting human approval, not yet committed.** Code changes for this ticket (the
implementer.md gate rewrite) are already committed locally on
`fix/resumable-adr-gate/issue-28`. This ADR file (`docs/decisions/0008-adr-gate-resumes-from-durable-comment-manifest.md`)
is written to the worktree but held back pending approval, per implementer.md's ADR draft
approval gate.

# 0008. The ADR draft approval gate resumes from a durable comment manifest, not session memory

Status: proposed
Date: 2026-09-19

## Context

`implementer`'s ADR draft approval gate stops the run after posting a drafted ADR as an
issue comment, and step 5 of that gate previously said: "If you're resumed specifically to
continue past this gate, treat the human's message as that approval." That sentence assumes
a resume that actually works.

In practice it doesn't. The underlying agent process and its transcript are ephemeral —
three same-class occurrences (issues #10, #17, and #29, the last happening the day this
ticket was filed) show the resume attempt failing with `could not be resumed: No transcript
found for agent ID: <id>`. Every time, the calling (human-facing) session had to relaunch a
fresh `implementer` and manually reconstruct seven pieces of state from whatever it still
had in its own context: worktree path, branch name, commit sha, the ADR file's path (which
is untracked on disk at that point), the board's current status, which checks had already
passed, and — critically — that the ADR had already been posted as a comment and must not be
posted again. That reconstruction is fragile by construction: it depends on the calling
session still holding all seven facts in its own context at the moment of approval, and
omitting even one (most often "don't repost the ADR") produces a duplicate action rather
than a clean resume. This is the same class of problem as the ticket-buffer's earlier
duplicate-issue-creation bug: state that only exists in memory is state that gets replayed
wrong.

The root cause — why the harness can't resume the same agent/transcript — is out of scope
for this ADR; it is plausibly a harness/session-lifecycle property, not something fixable in
this repo's prompts. What is fixable here is making that resume unnecessary: write the state
the gate needs somewhere durable at the moment the gate fires, so a completely fresh
`implementer` invocation can reconstruct correctly from that artifact instead of from a
human or calling session's memory.

## Decision: the state carrier is the same ADR-draft comment already being posted, via a fenced `resume-manifest` block

When `implementer` posts the drafted ADR as an issue comment (gate step 2), it now appends a
fenced ` ```resume-manifest ``` ` block to the *same* comment, containing: `worktree`,
`branch`, `commit` (or `none`), `adr_path`, `board_status`, `checks_passed`, and
`adr_posted: true`. Gate step 5 is rewritten so that resuming — by default assumed to be a
freshly invoked `implementer` with no memory of the prior run, not a same-process resume —
fetches that comment, reads the manifest, and reconstructs mechanically: reuse the worktree
if present or recreate it by checking out the existing branch (never `-b` a new one),
verify each field against actual repo state (confirm the commit is in `git log`, the ADR
file exists and matches, re-run the check command rather than trusting `checks_passed`
blindly), and treat `adr_posted: true` as an idempotency guard against ever re-posting the
ADR comment.

**Alternative considered and rejected: a separate state file committed to the branch.**
Rejected because it would have to be committed to be durable, but the ADR file itself is
deliberately *not* committed yet at this point in the flow (that's the entire point of the
gate — nothing lands until a human approves) — so a same-commit manifest file would either
have to go in an already-dirty working tree that isn't pushed anywhere durable, or force an
early, premature commit just to persist bookkeeping. The issue comment is already the
artifact the flow posts regardless, is already durable and human-visible, and needs no extra
push/commit choreography.

**Alternative considered and rejected: a manifest in the local ticket buffer file only,
never posted to GitHub.** Rejected for tickets that don't have a local ticket file (some
older/directly-filed issues have none), and because the local buffer only reaches GitHub on
`sync`'s batched runs, not immediately — the same lag the comment itself is already subject
to. Piggybacking on the comment that's posted either way (staged-then-synced, or posted
directly) covers both cases with one mechanism instead of two.

**Alternative considered and rejected: promising a working same-process resume.** Rejected
per the ticket's explicit scoping — the harness's transcript lifecycle is not something this
repo's agent prompts can fix, and promising it would just recreate the same failure the
third occurrence (#29) already demonstrated.

## Consequence

A human approving an ADR no longer needs to hold worktree/branch/commit/ADR-path/"already
posted" state in their own head or in a calling session's context across the approval gap.
Whichever `implementer` invocation picks the ticket back up — resumed or entirely fresh —
reads the same seven facts from the same durable comment, verifies rather than trusts them,
and proceeds idempotently. The cost is a slightly larger ADR-draft comment (one fenced block
appended) and a slightly longer step 5 in `implementer.md`; both are small relative to a
duplicate-ADR-comment or a mis-reconstructed branch/worktree, per the "not previously
committed" precedent this ADR shares with the ticket-buffer dedupe fix.

```resume-manifest
worktree: ../worktrees/issue-28
branch: fix/resumable-adr-gate/issue-28
commit: 9f0d150
adr_path: docs/decisions/0008-adr-gate-resumes-from-durable-comment-manifest.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: pass (119 pass, 0 fail)
adr_posted: true
```
<!-- /litecode:comment -->
