---
name: reviewer-batch
description: Reference for reviewer (not a skill; read on demand when the case arises).
---

# Batch review (reviewer)

Loaded by `reviewer` when `implementer` gives it several ticket paths for one PR (a batch of small tickets). The batch itself (limits, one branch and PR, per-ticket status) is defined in `.kilo/reference/implementer-batch.md` (relative to the primary checkout); this file only adds what `reviewer` does.

- Check the diff against each ticket separately: read every ticket's `## Critères d'acceptation` and output one `ACCEPTANCE:` block per ticket, headed by its id.
- A ticket with a `missing` or `contradictory` criterion caps only that ticket, and the `VERDICT` is `changes-requested` naming it; say plainly which tickets are clear.
- Attribute each finding to a ticket id (or `shared` when it spans several), so `implementer` can move each ticket on its own.
- Flag a commit or hunk that belongs to no listed ticket.
