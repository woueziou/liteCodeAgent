---
name: reviewer-single-pass
description: Used by reviewer only when implementer runs a single review pass (no bug-hunter): chore/doc tickets without src changes, and small tickets without logic. Adds the correctness hunt to the normal review.
---

# Single pass (reviewer)

Loaded by `reviewer` when `implementer` says no `bug-hunter` runs. Do your normal review, and also cover its job proportionately: for each changed behaviour, name one concrete failure scenario and confirm it by running the code where possible. Docs and pack text: check that what the change claims matches the code and that the tests pinning it exist and pass. Report correctness findings in `FINDINGS` with the usual blocking/non-blocking tags and `REENTRY`. Do not widen scope beyond the diff, and if the diff turns out to change logic under `src/`, say so in `FINDINGS` as blocking: it needed the two-pass flow.
