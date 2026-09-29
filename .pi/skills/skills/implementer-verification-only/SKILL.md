---
name: implementer-verification-only
description: "Used by implementer only when a ticket is an audit or drift check that needs no code change: no PR, reviewer re-derives the conclusion, ticket goes straight to Done."
---

# Verification-only tickets (implementer)

Loaded by `implementer` at step 6 when the ticket produces no code change. Step numbers refer to `implementer`'s numbered flow.

Audits and "confirm X still holds" tickets are done when nothing needs to change — don't force a PR. At step 6 instead: (1) leave your findings as a ticket note (what you checked, found, and why no change is needed); (2) invoke `reviewer` (step 8, with the ticket's path; `bug-hunter` has no diff) handing it your findings and asking it to independently re-derive your conclusion rather than rubber-stamp it; (3) on `approve`, move the ticket straight from `In Progress` to `Done` and add its verdict to the note; (4) if it disagrees, treat that as a normal finding — you may owe a code change.

