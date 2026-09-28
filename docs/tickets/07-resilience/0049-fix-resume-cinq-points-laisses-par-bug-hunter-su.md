---
schemaVersion: 2
id: 0049-fix-resume-cinq-points-laisses-par-bug-hunter-su
title: "fix(resume): cinq points laissés par bug-hunter sur la PR #84"
label: bug
status: readyToMerge
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Contexte
Findings non bloquants de bug-hunter sur la PR #84 (ticket 0034, journal de progression + `litecode resume`), laissés hors de la PR. Détail dans la note du ticket 0034 et les commentaires de la PR #84.

## Critères d'acceptation
- implementer écrit une entrée de journal après le commit de l'ADR et après l'ouverture de la PR, pour que `resume` ne s'appuie pas sur un journal périmé ; `resume` signale un journal en retard sur l'état du dépôt (commit plus récent sur la branche, PR ouverte non journalisée).
- `worktreeExists` résout un chemin de worktree relatif par rapport au checkout principal, pas au dossier courant : `resume` lancé depuis un worktree donne le même résultat.
- La lecture des blocs `progress-journal` et `resume-manifest` accepte les fins de ligne CRLF (comme `fenceRegions` dans src/tickets/spec.ts).
- Un bloc non refermé produit une erreur explicite au lieu d'avaler le bloc suivant.
- Les valeurs `commit` (sha hexadécimal) et `pr` (URL ou numéro) sont validées avant d'être passées à git et gh.
- Un test par point.

## Plan
1. packs/core/agents/implementer.md : déclencheurs du journal ; régénérer les agents.
2. src/report/journal.ts : CRLF, bloc non refermé, validation des valeurs.
3. src/resume.ts et src/report/probes.ts : résolution du chemin, détection du journal en retard.
4. tests/report-journal.test.ts, tests/resume.test.ts.

## Hors périmètre
Changer le format du journal (ADR 0018).

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/88 (branch `fix-resume-journal-drift/0049`, base `main`).

Implemented the five points: journal triggers added in `packs/core/agents/implementer.md` ("Writing on the ticket" — post-ADR-commit, post-`gh pr create`, re-rendered into all installed agent copies); `src/report/journal.ts` reworked to scan fenced blocks line-by-line (CRLF-safe, throws on an unclosed block instead of swallowing the next one, validates/drops invalid `commit`/`pr` values before they can reach git/gh); `src/report/probes.ts` resolves a relative worktree path against the primary checkout via `git rev-parse --git-common-dir` instead of the cwd `resume` happens to be invoked from; `src/resume.ts` now flags a journal that's fallen behind the repo (branch moved past the recorded commit, or an open PR never recorded). One test per point in `tests/report-journal.test.ts`, `tests/resume.test.ts`, `tests/report-probes.test.ts`.

**reviewer verdict (posted on the PR):** `VERDICT: approve` — all five acceptance criteria satisfied, plan fidelity matches, no out-of-scope touches to ticket 0047's files, `Agent: implementer` trailer present. `FINDINGS: none.`

**bug-hunter — first pass (commit a702005):** `HUNT: complete`, found two **blocking** findings:
1. `src/resume.ts` stale-commit check used exact string equality, so a normal abbreviated (7-char) or differently-cased journal `commit:` value (what `git commit` prints, and what every implementer.md template asks for), or `commit: NONE`, produced a false "journal is behind the repo" warning.
2. `src/report/journal.ts`'s fence regexes were anchored at column 0, so the indented `progress-journal`/`resume-manifest` templates implementer.md's own numbered-list items produce (2-3 space indent) were silently dropped — a real regression from the earlier code, which was unanchored.

Both fixed in commit `e393ebc`: the commit comparison is now a case-insensitive prefix match against the branch tip, "none" is normalized to a canonical lowercase at parse time, and the fence regexes allow up to 3 leading spaces (CommonMark, matching `fenceRegions` in `src/tickets/spec.ts`). Regression tests added for both. Five non-blocking findings were also raised (malformed-old-block blocks the whole ticket's resume, invalid commit/pr silently dropped with no warning finding, PR staleness check only covers open PRs, `cmdResume` reads a worktree's possibly-stale ticket copy — pre-existing, not introduced here, `primaryCheckoutRoot` assumes a standard `--git-common-dir` layout) — left for a follow-up ticket via `triage`, none block this PR.

**bug-hunter — re-hunt (commit e393ebc):** `HUNT: complete`. Verified both fixes by running the code (scratch repo, every commit-value shape, 0/2/3-space fence indents, CRLF + trailing spaces) rather than just reading the diff; confirmed `parseJournalEntries` gives identical output on `main` vs. this branch across every `.md` file under `docs/`. One further **non-blocking** finding: the indent-tolerant fence regexes introduce three narrow edge cases (mismatched open/close indent throws "unclosed"; 4+-space or tab-indented fences still silently give `no-journal`; a four-backtick-wrapped example block indented like a list item now parses as a real entry) — none hit by implementer.md's actual templates or any current ticket; folded into the same follow-up ticket as the other deferred findings.

All three reports posted verbatim on the PR (`gh pr comment`), confirmed via `gh pr view 88 --json comments` (3 comments). `bun run check` and `bun test` (354 pass) green on the final commit. Moving to Ready to Merge — no code-change follow-up needed before merge; the deferred non-blocking findings belong in a new ticket, not this one.
