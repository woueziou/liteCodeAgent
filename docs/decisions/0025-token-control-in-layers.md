---
generated_by: implementer
task: "0089"
---

# 0025. Token control in layers: drift report, word caps, per-release measurement

Status: accepted
Date: 2026-10-03

## Context

ADR 0021 capped one file, `implementer.md`, at 3,000 words (tested), because it had grown to about 7,400 words and was reloaded on every run. Every other agent and skill can still grow without anyone noticing, and the cost of a prompt is paid on every launch. The restructure (tickets 0087, 0088, 0092) cut the 12 rendered agents from 10,334 words to about 10,000; nothing yet keeps them there.

## Decision

This ADR extends ADR 0021 from one agent to every agent and every skill of every pack. Token control has layers, from cheapest to most expensive:

1. **A non-blocking drift report.** `litecode packs --sizes` prints, for each agent and each skill of every pack, its size in words now against a recorded previous size, with a `!` warning marker when the file grew by more than 10 %. It always exits 0. The threshold is 10 %: below it, a one-rule edit moves a 1,000-word agent by less than noise, and above it a file has gained several rules; the report is advisory, so a slightly low threshold costs nothing.
2. **A word cap per agent and per skill, enforced in `bun test`.** One table in `tests/pack-word-caps.test.ts` lists every file with its cap, set from the sizes after tickets 0087 and 0088 plus a margin of 5 to 10 %. Raising a cap is a visible, reviewable diff of that table. A new agent or skill without a row fails the test. The existing implementer caps (3,170 body words, 12,000 bytes) stay as they are.
3. **A per-release reference-ticket measurement**, manual and outside `bun test`: the fixture and protocol in `docs/specs/restructure-baseline/` replayed with `litecode token-report`. Words are a proxy; this layer measures what a run actually costs.
4. **A tokenizer estimate is not added.** It becomes an option only if words prove too coarse (for example if a wording change moves cost without moving words). No dependency is added now.

### What "previous version" means

The previous version is the last released one, recorded in a committed snapshot, `docs/token-sizes.json` (file path to word count). The snapshot is not derived from git history or the published package: a file is the simplest reliable source, works offline and in a shallow clone, and the diff of the file at release time shows the drift too.

Sizes are the word count of the pack source file (frontmatter and template tags included), the same unit as the caps and independent of any project config.

**Refreshing the snapshot** is a deliberate maintainer step at release time, after reading the report: run `litecode packs --sizes --update`, review and commit `docs/token-sizes.json` with the release. Without a snapshot the report prints the current sizes and says there is nothing to compare with.

## Consequences

- A prompt that grows by more than 10 % since the last release shows up in the report; one that crosses its cap fails CI.
- The caps are a ceiling, not a target. A cap raised in a PR is a decision that reviewers see.
- Words undercount tokens for code-heavy text and overcount for prose; layer 3 is the check on that.
- The snapshot can go stale if the maintainer forgets to refresh it: the report then compares with an older release, which only makes it warn more, never less.
- Reference files (`reference/*.md`) are loaded on demand and are neither agents nor skills; they are not capped here.
