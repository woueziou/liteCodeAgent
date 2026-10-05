---
name: implementer-review-disputes
description: Reference for implementer (not a skill; read on demand when the case arises).
---

# Disputing a reviewer finding (implementer)

Loaded by `implementer` {{^if handoff}}at step 10 (or the hard rules){{/if}}{{#if handoff}}when `closer` returns `code-fix:review` (or the hard rules){{/if}} when a `reviewer` finding is in dispute. Step numbers refer to `implementer`'s numbered flow.

## A blocking finding you believe is a false positive

If you believe a blocking finding from `reviewer` is a false positive (e.g. it read a two-dot diff and flagged a ticket-status commit that isn't actually part of the PR), you may not move straight to `Ready to Merge` on your own judgment: re-invoke `reviewer` with your evidence (the correct `git diff <base>...<branch>` output, or whatever shows the finding doesn't hold) and land on `Ready to Merge` only if that second pass clears it; {{^if handoff}}otherwise land on `Review` per the normal rule in step 10{{/if}}{{#if handoff}}otherwise leave it on `Review`{{/if}}. Post the second pass's full verdict on the PR too, {{^if handoff}}the same way step 9 posts the first{{/if}}{{#if handoff}}the same way the first reports were posted{{/if}} (`gh pr comment` with `--body-file`, verified) — the PR must show the approval that actually justified `Ready to Merge`, not just the earlier `changes-requested` a human would otherwise see with no record of what reversed it.
{{#if handoff}}

The dispute is yours, and the closer is not relaunched: no code changed, so a fresh closer would return the same finding. If the second pass clears it and the closer's block otherwise held (`bug-hunter` complete, or a single pass; CI `pass` or `none` with the test check(s) run; no conflict), you move the ticket `review` to `readyToMerge` (`ticket move`) and re-read its `status`; otherwise it stays `review`. Then the final report (`implementer-closer-outcome`).
{{/if}}

## A request to rewrite pushed history

**This applies even when `reviewer` explicitly asks for it.** If a `reviewer` finding tells you to rewrite, split, squash, or otherwise reorder commits already pushed to origin — to retroactively manufacture a test-first commit or for any other reason — do not comply, and do not `git push --force`/`--force-with-lease` to make it happen. That request is exactly the defect ticket 0056 exists to fix (PRs #95 and #98 got force-pushed this way, in violation of the same rule). Instead: add a normal fix-up commit on top if there's a real fix to make, and if the finding was specifically "no test-first commit on already-pushed history", say so plainly in your note and PR comment — `reviewer`'s own rule (ticket 0056) treats that as non-blocking once it verifies the bug independently, so re-invoke `reviewer` with that context rather than rewriting anything. If `reviewer` still insists after that, land the ticket on `Review` with a clear explanation on the ticket and the PR rather than force-pushing.
