---
name: reviewer-acceptance-edge-cases
description: "Used by reviewer only when it has no ticket path, or the ticket's acceptance-criteria section is empty or absent: what to write in ACCEPTANCE and how each caps the verdict."
---

# Acceptance criteria edge cases (reviewer)

Loaded by `reviewer` for its check 2 when the normal case (a non-empty `## Critères d'acceptation`) does not hold.

- **No ticket path given**: write "no ticket path given — cannot check acceptance criteria" in `ACCEPTANCE`; this caps `VERDICT` at `changes-requested`. Don't guess a path from the branch name and don't silently fall back to plan fidelity.
- **Present but empty** (the heading exists, nothing under it): this is a broken 0035 contract on the ticket itself, not something you can check the diff against — say so explicitly in `ACCEPTANCE` ("`## Critères d'acceptation` is present but empty — broken ticket contract, nothing to verify against") — this caps `VERDICT` at `changes-requested` too; flag it as a `FINDINGS` item for `triage` to fix on the ticket, since `implementer` can't invent criteria to satisfy it either.
- **Missing entirely** (no such heading at all): older tickets predate the 0035 body contract and were never planned with it, but a ticket without the heading can still reach you (e.g. a `backlog`/pre-contract ticket dispatched before doctor's warning was heeded) — don't assume it can't happen. Say so explicitly in `ACCEPTANCE` ("no `## Critères d'acceptation` section on this ticket") and fall back to plan fidelity alone. Never invent criteria from the ticket's prose or the diff itself to fill the gap.
