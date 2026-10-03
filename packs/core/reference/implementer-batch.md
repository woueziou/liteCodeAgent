---
name: implementer-batch
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Batch of small tickets (implementer)

Loaded by `implementer` when it is given several tickets to do as one batch (at most 4, all `small`, ideally the same epic, no file in common with another batch). One worktree, branch and PR replace one per ticket; everything else stays per ticket.

- Refuse to start (escalate to `triage`, touching no ticket) if there are more than 4 tickets or one is not `small`.
- Read every ticket file. Move each from `Planned` to `In Progress` with its own `ticket move` before any code. Each ticket keeps its own status, notes and progress journal.
- One worktree and one branch, named after the lowest id (`<descriptive-name>/<NNNN>`). One commit per ticket, each naming that ticket's id. Run the full checks once, before the push.
- One PR whose body has one `Ticket: <NNNN-slug>` line and file path per ticket. Wait for CI as usual.
- One review round: start `reviewer` and `bug-hunter` once, give `reviewer` every ticket file path, and ask for one `ACCEPTANCE` block per ticket. Post their reports on the PR once.
- Move each ticket on its own: `Ready to Merge` only if the reports and CI clear that ticket's criteria; a ticket whose criteria are not all satisfied goes to `Review`, without holding back the others. A blocker on one ticket moves only that ticket to `Blocked`; drop it from the batch and carry on with the rest.
- Leave a note on each ticket (PR link, verdicts, its own `ACCEPTANCE` lines).
- Final report: one block per ticket (`TICKET`, `STATUS`, `BLOCKER`), all sharing `BRANCH`, `PR`, `CI` and `CHECK_OUTPUT`.
