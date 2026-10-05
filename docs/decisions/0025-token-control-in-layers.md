---
generated_by: implementer
task: "0089"
---

# 0025. Token control in layers: drift report, word caps, per-release measurement

Status: accepted
Date: 2026-10-03

## Context

ADR 0021 set a target of at most 3,000 words for the body of one file, `implementer.md`, because it had grown to about 7,400 words and was reloaded on every run. Every other agent and skill can still grow without anyone noticing, and the cost of a prompt is paid on every launch. The restructure (tickets 0087, 0088, 0092) cut the agents' source files to about 10,000 words, but that is the source: measured as the model reads them (rendered, with the baseline fixture config), the 12 agents total 10,331 words today against 10,334 in `docs/specs/restructure-baseline/`, so the rendered total did not move (-3 words). The helper and reference text that the templates expand grew as the source shrank, which is why the measure has to be the rendered one. Nothing yet keeps either number from growing.

## Decision

This ADR extends ADR 0021 from one agent to every agent and every skill of every pack. Token control has layers, from cheapest to most expensive:

1. **A non-blocking drift report.** `litecode packs --sizes` prints, for each agent, skill and reference file of every pack, its rendered size in words now against a recorded previous size (and the source word count as information), with a `!` warning marker when the file grew by more than 10 %. It always exits 0. The threshold is 10 %: below it, a one-rule edit moves a 1,000-word agent by less than noise, and above it a file has gained several rules; the report is advisory, so a slightly low threshold costs nothing.
2. **A rendered word cap per agent, skill and reference file, enforced in `bun test`.** One table in `tests/pack-word-caps.test.ts` lists every file with its cap, set from the rendered size on 2026-10-03 plus a margin of about 8 %. Raising a cap is a visible, reviewable diff of that table, and a failure message says so. A new file without a row fails the test. The existing implementer caps are separate and stay as they are: `tests/implementer-size-flow.test.ts` caps the source body of `implementer.md` (after the frontmatter) at 3,170 words, and the whole source file at 12,000 bytes. The 3,000 words of ADR 0021 was the target when it was written; the tested cap was raised to 3,150 (ticket 0064) and 3,170 (ticket 0065), so the true cap is 3,170 source body words.
3. **A per-release reference-ticket measurement**, manual and outside `bun test`: the fixture and protocol in `docs/specs/restructure-baseline/` replayed with `litecode token-report`. Words are a proxy; this layer measures what a run actually costs.
4. **A tokenizer estimate is not added.** It becomes an option only if words prove too coarse (for example if a wording change moves cost without moving words). No dependency is added now.

### What "previous version" means

The previous version is the last released one, recorded in a committed snapshot, `docs/token-sizes.json` (file path to word count). The snapshot is not derived from git history or the published package: a file is the simplest reliable source, works offline and in a shallow clone, and the diff of the file at release time shows the drift too.

Units: sizes and caps are rendered words, counted on the text the install writes (frontmatter and template output included), with `countWords` of `src/pack-sizes.ts`. The render goes through `buildPlan` with a fixed config (the baseline fixture for the `core` pack, a minimal fixed `project.web` block for the `web` pack), so sizes do not depend on any one project and a longer helper in `src/delegation.ts` or a partial counts. Skills marked `install: referenced` are rendered too. The implementer caps above are the exception: they count source.

**Refreshing the snapshot** is a deliberate maintainer step at release time, after reading the report: run `litecode packs --sizes --update`, review and commit `docs/token-sizes.json` with the release. Without a snapshot the report prints the current sizes and says there is nothing to compare with.

## Consequences

- A prompt that grows by more than 10 % since the last release shows up in the report; one that crosses its cap fails CI.
- The caps are a ceiling, not a target. A cap raised in a PR is a decision that reviewers see.
- Words undercount tokens for code-heavy text and overcount for prose; layer 3 is the check on that.
- The snapshot can go stale if the maintainer forgets to refresh it: the report then compares with an older release, which usually only makes it warn more. It can also hide a regression: a file that grew and then shrank again since that release shows no change, and a file that grew a little at a time shows each step against an old reference. The caps, not the report, are the guard.
- Reference files (`reference/*.md`) are loaded on demand, but each one is read in full when the case arises, so they are measured and capped like agents and skills.
