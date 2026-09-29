---
schemaVersion: 2
id: 0053-fix-journal-durcir-la-lecture-des-blocs-de-journ
title: "fix(journal): durcir la lecture des blocs de journal et des titres ADR à valider"
label: bug
status: readyToMerge
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Findings non bloquants laissés par bug-hunter sur la PR #88 (ticket 0049, lecture du journal de progression) et la PR #89 (ticket 0047, ADR en attente). Même sujet : la tolérance des parseurs de src/report/journal.ts et src/decisions/pending.ts. Détails et sondes dans les commentaires des deux PR.

## Critères d'acceptation
- src/decisions/pending.ts : le titre `## ADR à valider : NNNN` est reconnu sur sa seule ligne (le suffixe optionnel ne peut pas traverser un retour à la ligne) ; un suffixe collé (`0018: …`, `0018—…`) est accepté ; le texte de l'ADR est rendu dans tous ces cas.
- src/report/journal.ts : un bloc ouvert à 0-3 espaces et refermé plus indenté est traité de façon cohérente (pas d'erreur « unclosed » là où un bloc est simplement mal indenté) ; les blocs indentés de 4 espaces ou plus, ou avec des tabulations, donnent un avertissement explicite au lieu de « pas de journal » silencieux.
- Un ancien bloc malformé ne bloque pas `resume` quand un bloc plus récent est valide.
- Une valeur `commit`/`pr` invalide est signalée dans la sortie de `resume`, pas ignorée silencieusement.
- La vérification de PR de `resume` couvre aussi une PR fermée ou fusionnée, pas seulement ouverte.
- `resume` lance depuis un worktree lit la copie du ticket du checkout principal, pas celle, périmée, du worktree.
- Un test par point.

## Plan
1. src/decisions/pending.ts : expression régulière du titre.
2. src/report/journal.ts : clôtures indentées, blocs malformés anciens, valeurs invalides signalées.
3. src/resume.ts / src/cli.ts : PR fermée ou fusionnée, lecture du ticket depuis le checkout principal.
4. tests/report-journal.test.ts, tests/resume.test.ts, tests/decisions/pending.test.ts (ou équivalent).

## Hors périmètre
Layout `--separate-git-dir` ; changement de format du journal (ADR 0018).

### 2026-09-29 — implementer: PR opened, reviewed

PR: https://github.com/woueziou/liteCodeAgent/pull/103 (CI green, mergeable).
reviewer: VERDICT approve-with-notes (no blocking findings). bug-hunter: HUNT complete, no blocking findings. Both reports posted on the PR.
Fixed same-PR: old-git common dir in primaryCheckoutRoot, draftTextFor CRLF/trailing-space fence, listPendingAdrs no longer throws on an unclosed block.
Deferred (non-blocking, worth new tickets via triage): an unclosed journal block silently closed by an ordinary code fence; bare-repo primary-root mismatch between resume.ts and probes.ts; mixed space+tab indented fence is silently ignored. Unrelated: 3 timing-out tests in tests/report-probes.test.ts also fail on main.

```progress-journal
step: step 10: reviewed, ready to merge
worktree: .claude/worktrees/agent-abffb0cc06de0087a
branch: fix-journal-parsing/0053
base: main
commit: pushed tip of branch
checks: bun run check: pass; CI pass
pr: https://github.com/woueziou/liteCodeAgent/pull/103
```
