---
schemaVersion: 2
id: 0043-feat-agents-planner-et-tracker-posent-a-clarifie
title: "feat(agents): planner et tracker posent [À CLARIFIER] sur les questions ouvertes"
label: feature
status: readyToMerge
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Finding non bloquant de bug-hunter sur la PR #80 (ticket 0035). `ticket move` refuse le passage en planned tant que `[À CLARIFIER]` est présent, mais aucun agent n'émet ce marqueur : le blocage existe sans que le flow ne l'alimente jamais. Une question restée ouverte dans le débat (synthesizer `unresolved-tension`, hypothèse non vérifiée du planner) arrive donc dans le ticket comme une affirmation.

## Critères d'acceptation
- planner signale explicitement ses questions ouvertes (ligne dédiée dans sa sortie) au lieu de les trancher.
- tracker écrit chaque question ouverte reçue dans le corps du ticket, préfixée par `[À CLARIFIER]`, dans la section concernée.
- Le skill idea-to-planned s'arrête proprement quand le ticket créé porte le marqueur (dispatcher ne peut pas le planifier) et le dit à l'humain.
- triage, qui a déjà le droit de retirer le marqueur, reste la seule voie de sortie avec l'humain.
- Tests de contrat sur les prompts (tests/agents-*), agents installés régénérés.

## Plan
1. packs/core/agents/planner.md : ajouter une sortie `OPEN_QUESTIONS:`.
2. packs/core/agents/orchestrator.md : relayer `OPEN_QUESTIONS` tel quel.
3. packs/core/agents/tracker.md : écrire les questions avec le marqueur.
4. packs/core/skills/idea-to-planned/SKILL.md : gérer le refus de ticket move.
5. Tests + `install --apply`.

## Hors périmètre
Détecter automatiquement des questions dans du texte libre.

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/87 (branch `feat-open-questions-clarify/0043`, base `main`).

`reviewer`: `VERDICT: approve`, no findings, plan fidelity matches, all acceptance criteria satisfied.

`bug-hunter` first pass: `HUNT: complete`, one blocking finding (off-by-one step reference in `idea-to-planned/SKILL.md` after planner's renumbering — "Skip straight to step 5's report" should have said step 6) plus five non-blocking findings (tracker's "isn't literally `none`" wording vs orchestrator's sentinel values; planner citing an unreachable `unresolved-tension` source and no separation from `ADR_DECISIONS`; surface-only tests; hardcoded README path). Fixed in same-PR commit `b92f537`: corrected the step reference, named tracker's exact sentinel values, removed the unreachable clause and added an explicit `OPEN_QUESTIONS`/`ADR_DECISIONS` separation sentence, and strengthened the tests to check the fenced output contract and the step-number reference dynamically (mutation-tested). Left the hardcoded `docs/tickets/README.md` path as-is per bug-hunter's own "fine to leave" framing.

`bug-hunter` re-hunt (after the fixup, per the one-re-hunt rule): `HUNT: complete`, no new blocking findings; branch declared safe to land. Three residual non-blocking items remain for later, not blocking this PR:
- `orchestrator.md`'s `OPEN_QUESTIONS` sentinel has no explicit value for the case where `planner` is unreachable because `synthesizer` reported `unresolved-tension` (narrow: `idea-to-planned` already stops on `BLOCKING_TENSION` before calling `tracker`, and any leak fails safe — the marker still blocks `planned`).
- `planner.md`'s output-block description (line ~53) still uses older wording ("an unresolved tension or an unverified assumption") that doesn't exactly match step 3's updated prose; cosmetic only.
- `tests/agents-open-questions.test.ts` doesn't yet catch a mutation that drops `idea-to-planned` step 3's handoff of `OPEN_QUESTIONS:` to `tracker` (the prose is correct today, only regression coverage is missing).

All three verdicts (reviewer approve, bug-hunter first pass with the blocking finding, bug-hunter re-hunt clearing it) are posted verbatim on the PR. Moved `inProgress -> readyToMerge`; PR is `MERGEABLE`/`CLEAN`.
