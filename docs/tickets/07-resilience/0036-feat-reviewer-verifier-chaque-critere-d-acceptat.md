---
schemaVersion: 2
id: 0036-feat-reviewer-verifier-chaque-critere-d-acceptat
title: "feat(reviewer): vérifier chaque critère d'acceptation avec une preuve"
label: feature
status: readyToMerge
priority: medium
size: small
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 4. Dépend du ticket « contrat de ticket structuré ».

## Contexte
reviewer vérifie la fidélité au plan, pas l'atteinte de l'objectif. Le verifier de GSD contrôle « l'objectif, pas seulement le passage des tests » ; converge de Spec Kit classe les écarts (manquant / partiel / contradictoire / non demandé).

## Critères d'acceptation
- reviewer produit une ligne par critère d'acceptation : satisfait / partiel / manquant, avec preuve (fichier:ligne, test, sortie de commande).
- Tout critère non prouvé donne `changes-requested`.
- Les ajouts non demandés par le ticket sont signalés.
- Test de contrat sur le prompt (tests/agents-*).

### 2026-09-28 — implementer: PR opened, both passes clean after one fixup round

https://github.com/woueziou/liteCodeAgent/pull/81 — branch `feat-reviewer-acceptance-criteria/0036`, base `main`. reviewer.md now checks each `## Critères d'acceptation` line with proof (satisfied/partial/missing/contradictory), caps `VERDICT` at `changes-requested` on any non-satisfied criterion or a missing ticket path, distinguishes an empty-but-present section from a missing one, flags not-requested additions, and carries an `ACCEPTANCE:` field in its Output contract. implementer.md step 8 now hands `reviewer` the ticket file's path explicitly. New contract test: tests/agents-acceptance-criteria.test.ts. Installed copies (.claude, .kilo, .pi) re-rendered via `install --apply`.

**reviewer (pass 1, commit 4b3faac)**: `VERDICT: changes-requested` — one blocking finding, that merging the PR would revert the ticket's `status` field to `planned`. Verified as a false positive: the PR diff never touches any ticket file (`git diff origin/main...HEAD --stat` confirms), since ticket files are committed only on `main` directly per this project's convention — resolved-not-reproduced, no fixup needed. `PLAN_FIDELITY: matches`, all four criteria addressed. `CHECK_OUTPUT`: tsc clean, 292/292 tests pass.

**bug-hunter (pass 1, commit 4b3faac)**: `HUNT: complete` — two blocking findings: (1) reviewer's prompt told it to read the ticket, but implementer's step 8 never actually handed it the ticket path, so a reviewer following the documented flow literally would silently fall back to plan fidelity and could approve; (2) a `partial` criterion (which has *some* proof) didn't clearly cap `VERDICT`, contradicting the ticket's "tout critère non prouvé donne changes-requested". Plus five non-blocking findings (empty-vs-missing section conflated with a false stated reason, `contradictory` missing from the enum, a vacuous `/missing/` test assertion, `ACCEPTANCE` missing from the Working-language rule, `ACCEPTANCE` missing from implementer's ticket-note format).

Fixed all but the last (deferred, new ticket via triage) in commit 5034d7f: implementer step 8 now hands over the ticket path explicitly; reviewer refuses to guess it and caps `VERDICT` if it's missing; any non-`satisfied` criterion (partial/missing/contradictory) now caps `VERDICT`; present-but-empty is now a distinct, flagged case; the false "never get re-reviewed" claim was removed; `contradictory` added to the enum; the test's `missing` assertion tightened to the full enum line; `ACCEPTANCE` added to the Working-language rule. `bun run check` clean, 296/296 tests pass.

**bug-hunter (pass 2, re-hunt on commit 5034d7f)**: `HUNT: complete` — verified all six pass-1 items fixed as described, no new blocking finding. Two small non-blocking points (verification-only path not repeating the ticket-path requirement; a stated reason for the English-only rule that didn't match the actual codebase) fixed same-PR in commit 3bedeb2, re-verified (`bun run check` clean, 296/296 tests pass). `REENTRY: none needed`.

Both passes clean. Not filed as a follow-up: `ACCEPTANCE` isn't yet echoed into implementer's ticket-note format (step 10) — left for a future ticket via triage, since the full verdict already reaches the PR comment (step 9) and isn't blocking.

Moved `inProgress` → `readyToMerge`.
