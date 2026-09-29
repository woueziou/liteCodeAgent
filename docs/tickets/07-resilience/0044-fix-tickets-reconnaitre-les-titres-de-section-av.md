---
schemaVersion: 2
id: 0044-fix-tickets-reconnaitre-les-titres-de-section-av
title: "fix(tickets): reconnaître les titres de section avec apostrophe typographique ou accents décomposés"
label: bug
status: readyToMerge
priority: low
size: small
assignedAgent: human
dueDate: 
importedFrom: 
---

## Contexte
Finding non bloquant de bug-hunter sur la PR #80 (ticket 0035). `ticketSection()` (src/tickets/spec.ts) compare le titre `## Critères d'acceptation` octet pour octet. Écrit avec une apostrophe typographique (U+2019, ce que produisent beaucoup d'éditeurs et le correcteur de macOS) ou un « è » décomposé (NFD), le titre n'est pas trouvé : `ticket doctor` avertit à tort qu'un ticket actif n'a pas de critères, et le 0036 (reviewer) ne trouverait pas les critères.

## Critères d'acceptation
- La recherche de section normalise en NFC et traite ’ (U+2019) et ' comme équivalents, pour tous les titres de CONTRACT_SECTIONS.
- La casse et les espaces en fin de titre n'empêchent pas la correspondance.
- Tests : titre avec U+2019, titre en NFD, titre avec espace final.

## Plan
1. src/tickets/spec.ts : fonction de normalisation de titre utilisée par ticketSection().
2. tests/tickets-contract.test.ts : cas ci-dessus.

## Hors périmètre
Réécrire les titres dans les fichiers existants.

### 2026-09-29 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/95
Branch: fix-ticket-section-headings/0044

`ticketSection()` in `src/tickets/spec.ts` now normalizes both the target heading and every
candidate `## ` heading (NFC, fold U+2018/U+2019/U+02BC apostrophe variants to `'`, trim,
lowercase) before comparing. Tests added in `tests/tickets-contract.test.ts` for U+2019, NFD,
trailing whitespace, and (added after bug-hunter's finding below) an empty `##` line no
longer hiding the next heading.

Per `testFirst: bugs`, the branch was restructured into a failing-tests-first commit
(9d1c818, 7 pass/2 fail against the pre-fix code) followed by the fix (5479f47, 9 pass/0
fail), then a same-PR fixup (47bb9cc) for two non-blocking findings bug-hunter raised on
this same PR (a quadratic regex on long trailing-whitespace heading lines, and a regression
where an empty `##` line swallowed the heading right after it) — both fixed by switching the
heading regex from `/^##\s+(.*?)\s*$/gm` to `/^##[ \t]+([^\r\n]*)$/gm`.

**reviewer, pass 1 (commit e27ec5f):** `changes-requested` — blocking: no failing-test
commit preceding the fix (testFirst gap). Non-blocking: NFD/apostrophe combined case not
covered (out of scope per acceptance criteria, no action needed).

**bug-hunter (commit e27ec5f, findings apply equally to 5479f47):** `HUNT: complete` — two
non-blocking, confirmed findings (quadratic regex on long trailing whitespace; empty `##`
line hides the next heading), both fixed in 47bb9cc. One additional non-blocking finding
(normalizeHeading doesn't cover U+FF07/NBSP/doubled spaces) explicitly out of this ticket's
scope, deferred.

**reviewer, pass 2 (commit 47bb9cc, after the test-first restructure and bug-hunter
fixup):** `approve-with-notes` — testFirst verified directly (checked out 9d1c818 in a
throwaway worktree, confirmed 7 pass/2 fail there). No outstanding findings.

Full verdicts posted verbatim on the PR (3 comments: reviewer pass 1, bug-hunter, reviewer
pass 2). CI (`test`, GitGuardian) passes on the PR. Moved `inProgress -> readyToMerge`.
