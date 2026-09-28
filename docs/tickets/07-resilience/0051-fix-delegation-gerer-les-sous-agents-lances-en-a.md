---
schemaVersion: 2
id: 0051-fix-delegation-gerer-les-sous-agents-lances-en-a
title: "fix(delegation): gérer les sous-agents lancés en arrière-plan au lieu de rendre un rapport intermédiaire"
label: bug
status: readyToMerge
priority: high
size: small
assignedAgent: human
dueDate: 
---

## Contexte
`src/delegation.ts` affirme à chaque agent que « every delegation is blocking: wait for the other agent's result in the same turn ». Dans les versions actuelles de Claude Code, l'outil `Agent` lance le sous-agent en arrière-plan et rend la main tout de suite ; le résultat arrive plus tard par notification. Constaté 3 fois le 2026-09-28 (tickets 0045, 0041, 0043 : l'implémenteur a lancé reviewer et bug-hunter puis rendu un message « WAITING / not final » à la place de son rapport `STATUS:`). Le 0045 et le 0041 ont ensuite terminé sans jamais renvoyer de rapport final : l'appelant a dû vérifier la PR et le ticket à la main. L'implémenteur prend ce comportement pour une faute (implementer.md, étape 8) alors que c'est l'outil.

## Critères d'acceptation
- Le texte de délégation de la cible claude-code (et des cibles qui partagent ce comportement) décrit les deux cas : résultat dans le même tour, ou sous-agent en arrière-plan dont on attend la notification de fin avant de continuer.
- Un agent qui a lancé des sous-agents en arrière-plan ne rend jamais de rapport intermédiaire : il attend leurs résultats, puis rend un seul rapport final au format attendu (`STATUS:` pour implementer).
- implementer.md (étape 8 et règle associée) est aligné sur ce texte : lancer reviewer et bug-hunter ensemble reste la règle, et « attendre » veut dire attendre les deux notifications.
- Si l'agent se termine malgré tout sans rapport final, `verify-report` sur une sortie vide reste une erreur explicite (comportement actuel) ; le skill chained-implementation dit à l'appelant de vérifier alors PR, verdicts et ticket lui-même.
- Tests : rendu du texte de délégation par cible ; test de contrat sur implementer.md ; agents installés régénérés.

## Plan
1. src/delegation.ts : texte par cible.
2. packs/core/agents/implementer.md : étape 8 et règle « never end your run between invoking reviewer/bug-hunter ».
3. packs/core/skills/chained-implementation/SKILL.md : conduite à tenir sans rapport final.
4. tests/ + `install --apply`.

## Hors périmètre
Changer le fonctionnement de l'outil Agent de Claude Code.

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/91
Branch: `fix-delegation-background-agents/0051`, worktree `../worktrees/0051`, based on `origin/main` (merged origin/main mid-run to pick up PR #90's lockfile refresh, took main's lockfiles, re-rendered with `install --apply --force`).

This run itself hit exactly the bug this ticket fixes: `reviewer` and `bug-hunter`, invoked together via the `Agent` tool, both returned as background-task completion notifications in later turns rather than in the same turn as the call. No interim report was sent while waiting — this note documents what actually happened, as evidence for the delegation text.

**`reviewer` verdict:** `VERDICT: approve`, no findings, plan fidelity matches all 4 plan steps. Posted verbatim on the PR.

**`bug-hunter` first pass:** `HUNT: complete`, one **blocking** (plausible) finding: the new claude-code delegation text self-contradicted — it said a notification "arrives later, in a later turn" while also saying "Never end your turn … until both have actually reported back to you." A later-turn notification can only arrive after the current turn ends, so the text asked for something impossible. One non-blocking finding: chained-implementation's SKILL.md step 6 didn't distinguish "implementer's own call hasn't resolved yet" from "implementer reported back with nothing in it." Posted verbatim on the PR.

Fixed both (commit `bcaae9b`): reworded `src/delegation.ts`'s `claude-code` case and implementer.md's step 8 + hard rule to say a notification can only arrive after the turn ends, so letting the turn end silently while waiting is correct — what's forbidden is sending any report (final or interim) before every delegation has reported back. Added the missing sentence to SKILL.md step 6. Re-ran `bun run check`/`bun test` (372/372), re-rendered, pushed.

**`bug-hunter` re-hunt (required for the blocking finding):** `HUNT: complete`, confirmed the contradiction was resolved with no new blocking issue. Three non-blocking findings: (1) the fixup's "never allowed to write anything at all" phrasing clashed with implementer.md's own progress-journal-note instruction; (2) no instruction for a notification that never arrives (lost/crashed background agent) — pre-existing, visible to a human watching an idle session, deferred; (3) the tests didn't pin the fixed wording itself, so a regression back to the contradiction would still pass CI. Posted verbatim on the PR.

Fixed (1) and (3) as a further same-PR fixup (commit `4da2767`, no additional bug-hunter re-hunt — one re-hunt per run, and these were non-blocking): narrowed the hard-rule wording to "sending anything" with an explicit progress-journal-note carve-out, and added render-test assertions pinning the absence of "never end your turn" and the presence of the new "can only reach you after the current turn" wording. Re-ran `bun run check`/`bun test` (373/373), re-rendered, pushed. Did not re-invoke `bug-hunter` again for this non-blocking fixup, per the one-re-hunt rule.

(2) — no instruction for a lost/crashed background delegation — is left open; worth a follow-up ticket via `triage` if it recurs in practice, but out of this ticket's scope (`Hors périmètre` explicitly excludes changing the Agent tool's own behavior, and this is a documentation gap about an edge case, not a defect in what shipped).

PR shows `mergeStateStatus: CLEAN`, `mergeable: MERGEABLE`. Primary checkout confirmed clean (`git status --short --untracked-files=all`) before this move — no leaked writes from either subagent invocation.
