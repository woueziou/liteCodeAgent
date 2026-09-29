---
name: implementer-ticket-commits
description: "Used by implementer only when committing a ticket-file change on the default branch in the primary checkout: the branch check, commit by path, and failure handling."
---

# Committing ticket files (implementer)

**Committing ticket files.** Every ticket-file change is committed right away on the default branch in the main checkout — the one standing exception to "never commit on the default branch", ticket files only:
- `git -C <primary-checkout> branch --show-current` must print the default branch; if not, don't switch (that checkout is the human's), leave the change uncommitted and say so in your report.
- Commit only the ticket files you changed, by path: `git -C <primary-checkout> add -- <paths> && git -C <primary-checkout> commit -m "chore(tickets): <NNNN> <what changed>" -m "Agent: implementer" -- <paths>`. Never push.
- If the commit fails (signing agent, `index.lock`), retry once, then leave it uncommitted and report; never disable signing or delete a lock file.

