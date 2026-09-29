---
schemaVersion: 2
id: 0039-chore-tests-rejouer-des-sessions-enregistrees-po
title: "chore(tests): rejouer des sessions enregistrées pour tester les contrats des agents"
label: chore
status: done
priority: low
size: medium
assignedAgent: human
dueDate: 
importedFrom: 
---

Source : audit du 2026-09-27, point 7.

## Contexte
Le comportement des prompts n'est vérifié que par des assertions de chaînes sur les templates. Aucun test ne confronte les contrats de sortie (STATUS:, PANEL:, HUNT:, VERDICT…) à de vraies réponses de modèle.

## Critères d'acceptation
- Des fixtures enregistrées via `litecode run --record` pour orchestrator, implementer (rapport), reviewer et bug-hunter.
- Un test rejoue ces fixtures et valide les contrats de sortie avec les parseurs existants (verify-report, etc.).
- Procédure documentée pour ré-enregistrer une fixture quand un prompt change.

### 2026-09-29 — implementer: PR #106 opened, landed on Review

PR: https://github.com/woueziou/liteCodeAgent/pull/106 (branch chore-replay-fixtures/0039, CI green on 2cc1ce8).

Approach: `litecode run --record` needs a paid key that was not available, so nothing was recorded from a runner. Reviewer (6) and bug-hunter (5) fixtures are real verdicts posted verbatim on PRs #76-#101. Implementer (3) and orchestrator (2) fixtures are hand-written from the prompt Output blocks (no real output was kept) and marked `synthetic` in `tests/fixtures/agent-sessions/manifest.json`. Re-record procedure: `tests/fixtures/agent-sessions/README.md`.

reviewer: `VERDICT: changes-requested`. The only blocking finding is criterion 1 ("recorded via --record") being `partial`, waivable by a human. Non-blocking: follow-up ticket to replace synthetic fixtures with real recordings once a key exists (Priority Low).
bug-hunter: `HUNT: complete`, no blocking findings. Three non-blocking findings fixed in 2cc1ce8; two deferred (sentinelFields first-key rule, manifest top-level check).
Both full reports are on the PR.

Human decision needed: waive the `--record` wording for now and merge, or keep the ticket open until a key exists.

```progress-journal
step: step 10: landed on Review
worktree: ../worktrees/0039 (harness worktree .claude/worktrees/agent-a07bae8fcf4fa5429)
branch: chore-replay-fixtures/0039
base: main
commit: 2cc1ce8
checks: bun run check: pass; replay test 27 pass; CI pass
pr: https://github.com/woueziou/liteCodeAgent/pull/106
```
