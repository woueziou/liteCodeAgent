---
schemaVersion: 2
id: 0035-feat-tickets-contrat-de-ticket-structure-avec-cr
title: "feat(tickets): contrat de ticket structuré avec critères d'acceptation"
label: feature
status: readyToMerge
priority: high
size: medium
assignedAgent: human
dueDate: 
---

Source : audit du 2026-09-27, point 3.

## Contexte
Le corps d'un ticket est du texte libre, et la sortie PLAN: de l'orchestrator n'est pas recopiée dans le ticket créé par tracker : le plan débattu peut se perdre. Spec Kit (spec.md + [NEEDS CLARIFICATION]) et GSD (REQUIREMENTS.md, REQ-IDs) structurent ce contrat.

## Critères d'acceptation
- Sections attendues dans le corps : Contexte, Critères d'acceptation, Plan, Hors périmètre.
- tracker recopie verbatim le PLAN et les REQUIREMENTS de l'orchestrator.
- `ticket doctor` signale un ticket planned/inProgress sans critères d'acceptation.
- Un marqueur `[À CLARIFIER]` (ou équivalent configurable) empêche le passage à planned (dispatcher + ticket move).
- `docs/tickets/README.md` documente le format ; les tickets existants (tous done) ne sont pas migrés.

### 2026-09-28 — implementer: PR opened, ready to merge

https://github.com/woueziou/liteCodeAgent/pull/80 (branch `feat-ticket-contract/0035`).

Implemented: `CONTRACT_SECTIONS`/`ticketSection()`/`CLARIFICATION_MARKER`/
`hasUnresolvedClarification()` in `src/tickets/spec.ts`; `litecode ticket move <id> planned`
refuses the move while the body's prose still carries `[À CLARIFIER]` (covers `dispatcher`
and `triage`, since both drive the move through that one command); `ticket doctor` warns on
a `planned`/`inProgress` ticket missing a filled-in `## Critères d'acceptation` section;
`tracker.md` now documents the four-section body contract and recopies `orchestrator`'s
`PLAN`/requirements verbatim; `docs/tickets/README.md` documents all of the above. Existing
`done` tickets intentionally not migrated, per acceptance criteria.

reviewer: `VERDICT: approve` — plan fidelity confirmed section by section, conventions and
attribution clean, `bun run check`/`bun test` both clean (286 pass), `REENTRY: none needed`.

bug-hunter: `HUNT: complete` — no blocking findings. Six non-blocking findings, three tagged
same-PR fixup and addressed in commit 96a6a1e before this note: (1) the marker check
previously matched inside fenced/inline code, so a ticket merely *mentioning* `[À CLARIFIER]`
(this ticket's own body included) could never reach `planned` again — fixed, marker check now
ignores fenced/inline code; (2) `triage.md` had no instruction to remove a resolved marker,
contradicting the append-only notes convention — fixed, documented as the one deliberate
exception; (3) `tracker.md` wrongly claimed `ticket move` also checks acceptance criteria —
corrected, it only checks the marker. Left as follow-up (not fixed here, non-corrupting):
no agent prompt currently emits `[À CLARIFIER]` for a new open question (flow-design gap);
`ticketSection`'s heading match misses a typographic apostrophe (U+2019) or NFD-normalized
"è" (false "missing section" doctor warning only). Full verbatim reports posted on the PR:
https://github.com/woueziou/liteCodeAgent/pull/80#issuecomment-5866363217

Re-verified after the fixup commit: `bun run check` clean, `bun test` 287 pass / 0 fail.
PR shows `mergeable: MERGEABLE`, no conflicts.
