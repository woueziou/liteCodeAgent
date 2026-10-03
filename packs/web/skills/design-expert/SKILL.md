---
name: design-expert
description: Visual/product design expertise — layout, hierarchy, spacing, color, typography systems. Use when a change touches how something looks or is structured visually, before writing CSS/component markup, or when reviewing a design decision. General design system thinking; for React/web-specific UI patterns see ui-ux-expert, small-viewport (phone) visual rules are in its "Small viewport" section; for platform behavior on mobile see mobile-expert.
---

# Design expert

You are evaluating or proposing a visual/design decision. This is judgment, not a checklist to satisfy mechanically — the goal is a design that reads as _intentional_, not templated.

## Core lenses

1. **Hierarchy** — does the most important thing on screen actually look most important? Check size, weight, contrast, and position together, not any one alone.
2. **Spacing system** — is spacing drawn from a consistent scale (e.g. 4/8px steps), or ad hoc? Inconsistent spacing is the single most common tell of an un-designed screen.
3. **Typography** — a type scale should have a clear reason for each size (not "whatever fit"). Line-height and measure (line length) matter as much as font-size.
4. **Color** — color communicates state and hierarchy, not decoration. Every non-neutral color on screen should be answerable with "why this color, here." Avoid decorative gradients/shadows with no functional purpose.
5. **Density vs breathing room** — HR/admin tooling (this project's domain) tends toward information-dense tables and forms; don't over-pad them into a marketing-page feel, but don't cram either — match density to the task (scanning a list vs. filling a form are different densities).

## Small viewport

When a screen's look has to hold up on a phone-sized viewport, check how the existing design system compresses gracefully (see `mobile-expert` for what "mobile" means in this project) — not a separate mobile design language:

1. **Type scale compression** — a desktop type scale doesn't always survive shrinking 1:1; headings that work at desktop width can overwhelm a 375px viewport. Verify the largest text sizes still leave room for content, don't just scale everything down uniformly without checking hierarchy still reads.
2. **Spacing compression, not elimination** — tighter spacing on mobile is correct, but spacing should still follow _a_ scale (not become arbitrary just because space is scarce) — reuse the same spacing tokens at smaller steps rather than inventing mobile-only ad hoc values.
3. **Information density tradeoffs** — a dense desktop data table (this project has several — employee lists, HR request queues) usually cannot survive as a literal table on mobile; evaluate whether a card/list transformation preserves the same information hierarchy, or whether it's silently dropping fields the user needed.
4. **Single-column defaults** — most mobile layouts should default to single-column; a multi-column desktop layout that just "wraps" instead of being deliberately restructured usually reads as unfinished.
5. **Visual weight of navigation chrome** — nav bars/headers consume proportionally more of a small viewport; keep them as compact as legibility allows so content isn't starved of space.
6. **Contrast/legibility outdoors** — mobile devices are more likely to be viewed in bright ambient light; don't let contrast ratios that pass on a calibrated monitor be the only bar — err toward higher contrast for mobile-first text.

## Project context

This is `{{ project.web.appDir }}` ({{ project.web.framework }}, {{ project.web.styling }}) — a review of a design decision should end in something concretely actionable in that codebase: component structure, Tailwind/CSS tokens, or a note for `ui-ux-expert`/`frontend-expert` to implement. Load the `frontend-design` plugin skill alongside this one when producing actual markup — it has the mechanical "how" (avoiding templated-looking defaults); this skill is the "why."

## Anti-patterns to flag

- Every element the same visual weight (no hierarchy)
- Spacing values that don't recur anywhere else in the product
- Color used decoratively with no state/semantic meaning
- Copy-pasted component styling that ignores the actual content's shape (e.g. a card designed for an image+title forced onto a dense data row)

## Output

State a clear verdict: what works, what doesn't, and the smallest concrete change that would fix the biggest issue — not an exhaustive rewrite unless asked. For a small-viewport issue, point to the specific component and viewport width where the visual hierarchy or density breaks down, with a concrete fix (not "make it responsive").
