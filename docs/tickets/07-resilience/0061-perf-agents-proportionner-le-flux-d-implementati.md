---
schemaVersion: 2
id: 0061-perf-agents-proportionner-le-flux-d-implementati
title: "perf(agents): proportionner le flux d'implémentation à la taille du ticket et alléger implementer.md"
label: feature
status: readyToMerge
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

## ADR à valider : 0021

Draft awaiting approval — not committed. File: /Users/woueziou/works/personal_projects/worktrees/0061/docs/decisions/0021-size-proportional-implementation-flow.md

# 0021. Size-proportional implementation flow, rare cases loaded on demand

Status: proposed
Date: 2026-09-29

## Context

Tokens declared by each implementer on 2026-09-28/29 ran from 80k to 190k per ticket (median about 135k), before the reviewers, plus 70k to 150k on every resume after an ADR. Ticket 0044, a few-line regex fix, cost about as much as a medium feature. Two causes: `implementer.md` had grown to about 7,400 words (roughly 10k tokens, three times `reviewer` and eight times `bug-hunter`), reloaded on every run and resume, one rule per incident, most of them only useful in rare cases; and every ticket ran the same flow (worktree, PR, CI, `reviewer`, `bug-hunter` at the most expensive tier, often a re-hunt and a second review).

## Decisions

1. **`implementer.md` keeps the nominal flow only; rare cases become skills.** The body targets at most 3,000 words (tested). The ADR approval gate and its resume, resuming and review fixups, GitHub outage, sub-agent-driven steps, stacked PRs, disputing a reviewer finding, leak cleanup, verification-only tickets and CLI resolution move verbatim into `implementer-*` pack skills, which the agent loads with the `Skill` tool only when the case arises. They are not listed in the agent's `skills:` frontmatter (that would preload them and defeat the point). Hard rules stay in the body. A test checks that every skill is referenced by the body and installed, and that each moved rule is still findable in its skill.
2. **The flow is proportioned to the ticket's `size`.** `small` (and `trivial`): still a worktree, a PR and both passes, but `bug-hunter` runs at the `balanced` tier, there is no re-hunt unless a finding is blocking, and no second `reviewer` pass for non-blocking corrections (`reviewer` returns `approve-with-notes`, `implementer` applies the notes and re-runs `bun run check`). `medium`/`large`: today's flow. The bar for a blocking finding does not change with size.
3. **The tier is chosen at the call, without duplicating agents.** A new `{{> delegateTier <tier>}}` helper renders "pass `model: "<model>"` on that call" for Claude Code (model taken from the configured `tiers`), whose `Agent` tool accepts a per-call model. Every other target (opencode, kilo-code, codex, pi) and the API runner, which fixes a model per agent tier, cannot choose per call: the prompt says so and the agent keeps its default tier. No capability is invented for them.
4. **Callers pass only the ticket and launch specifics.** `chained-implementation` (and the docs) say what is already inside `implementer.md` need not be repeated per launch: worktree, ticket commits on the default branch, CI, no forced push, single final report.

## Consequences

- Every implementer run and resume loads a prompt roughly 60% smaller; the measurement of the effect is a separate ticket (0062).
- A rule that is only in a skill is followed only if the agent loads it: the body's "Rare cases" list names the trigger for each, and the tests pin the list, but compliance is prompt-level, like every other rule here.
- On targets without per-call model choice, small tickets keep `bug-hunter` at `reasoning`: they lose only the saving from the tier, not the review.
- Ticket sizes are set by planning; a mis-sized ticket gets the wrong flow. A `small` ticket with a blocking finding still gets the re-hunt and second pass, so the cost of a wrong size is money, not an escaped defect.

```resume-manifest
worktree: ../worktrees/0061
branch: perf-proportional-flow/0061
commit: ea2a6d7
adr_path: docs/decisions/0021-size-proportional-implementation-flow.md
board_status: In Progress
checks_passed: bun run check: pass; bun test: 491 pass
adr_posted: true
```

### 2026-09-29 — implementer: ADR 0021 approved, PR opened, reviews in

ADR 0021 was approved by the human as written (relayed by the coordinator); it is now committed on the branch with Status: accepted, so the "Draft awaiting approval — not committed" line under `## ADR à valider : 0021` above is stale.

PR: https://github.com/woueziou/liteCodeAgent/pull/109 (CI: test pass, no conflicts). Merged origin/main (0062) into the branch, no rebase or force-push; installed agents re-rendered.
reviewer: VERDICT approve-with-notes. bug-hunter: HUNT complete, no blocking finding. Both reports are posted verbatim on the PR, with a comment on which non-blocking findings were fixed.
Deferred: bug-hunter finding 1 (tiers holding full model ids instead of aliases) and widening the moved-rule test; worth a follow-up ticket.
TOKENS: not visible to me.

```progress-journal
step: step 10: ready to merge
worktree: ../worktrees/0061
branch: perf-proportional-flow/0061
base: main
commit: see PR head
checks: bun run check: pass; bun test: 505 pass
pr: https://github.com/woueziou/liteCodeAgent/pull/109
```
