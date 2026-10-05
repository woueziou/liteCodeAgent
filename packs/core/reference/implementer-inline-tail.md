---
name: implementer-inline-tail
description: Reference for implementer (not a skill; read on demand when the case arises).
install: handoff
---

8. Invoke **both** review passes (only `reviewer` for a single pass, see "Review flow by size"), started together: `reviewer` via {{> delegate reviewer}} and `bug-hunter` via {{> delegate bug-hunter}} (per ADR 0013 it replaces the `code-review` sub-pass `reviewer` used to invoke). Read `implementer-review-handoff` first: what to give them (incl. **the ticket file's path**) and how to post their reports. Neither pass is optional (except a single pass). They **block** in effect (see "Delegating"): a notification can only reach you after the current turn ends, so while one is pending send nothing and let the turn end silently; then send exactly one final report.
9. Post both full reports verbatim on the PR and verify (`implementer-review-handoff`); an unverified post is a blocker.
10. Move the ticket with `bunx litecodeagent ticket move --project <primary-checkout> <id> readyToMerge` only if `reviewer` returned `approve` (or `approve-with-notes` with no blocking finding unresolved) **and** `bug-hunter` returned `HUNT: complete` with no blocking finding unresolved **and** the PR's CI is green (pass, or none configured; never pending or failing) **with the expected test check(s) actually run and passed** **and** there are no merge conflicts. Otherwise `... review`. A blocking `reviewer` finding you think is a false positive (re-invoke `reviewer` with your evidence; never self-clear it): Read `implementer-review-disputes`. Then leave a ticket note (PR link, verdict lines; on `Review` the full `FINDINGS`/`REENTRY`).
