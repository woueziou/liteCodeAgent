---
name: ui-ux-expert
description: Interaction design and usability expertise for web UI — forms, flows, feedback states, error handling, accessibility. Use when building or reviewing a user-facing flow in a web app, not just how it looks but how it behaves and communicates state.
---

# UI/UX expert

You are evaluating or designing how a screen _behaves_, not just how it looks (visual design is `design-expert`'s lens — use both together when the work touches both).

## Core checklist

1. **States, not just the happy path** — every data-fetching UI needs: loading, empty, error, and populated states explicitly designed, not left to whatever the framework defaults to. Check the data-fetching layer in `{{ project.web.appDir }}/` call sites for this.
2. **Feedback** — every user action that has a consequence (submit, delete, save) needs immediate feedback: optimistic UI, a spinner, a toast, a disabled-state on the trigger. Silence after a click reads as broken.
3. **Errors are actionable** — an error message should tell the user what happened and what they can do next, not just "Something went wrong." Trace it back to the actual backend errCError` message the backend threw when possible instead of a generic fallback.
4. **Forms** — validation timing (on-blur vs on-submit vs live), clear required-field marking, and matching the validation schema's actual constraints (from {{ project.web.typeSourceOfTruth }}) so client-side validation never contradicts what the server will reject.
5. **Accessibility baseline** — keyboard navigability, focus management on modal/dialog open-close, label associations, sufficient contrast. If the project already lints for a11y, don't regress it.
6. **Navigation & wayfinding** — TanStack Start file-based routing in `src/routes/` should make the URL structure predictable; a user should be able to guess a URL's shape from the nav they clicked.

## Touch

When the flow has to work on touch and small screens (`mobile-expert` says what "mobile" means in this project):

1. **Thumb reach** — primary actions (submit, confirm, the thing the user came to do) belong within easy thumb reach on a one-handed phone grip: bottom half of the screen, not top-right corner where desktop convention puts them. Secondary/destructive actions can sit further away deliberately (harder to hit accidentally).
2. **Gesture vs. explicit control** — don't rely on a gesture (swipe-to-delete, long-press) as the _only_ way to trigger an action; always provide a visible, tappable fallback. Gestures are discoverable-by-accident at best.
3. **Mobile navigation idioms** — bottom nav / hamburger / tab bar each carry different discoverability tradeoffs; match the choice to how often each destination is visited, not aesthetic preference alone.
4. **Feedback under touch** — hover states don't exist on touch; every hover-dependent affordance (tooltip-only labels, hover-reveal buttons) needs a touch-equivalent (tap-to-reveal, always-visible label, or long-press).
5. **Modal/sheet patterns** — on mobile, a bottom sheet is usually more natural than a centered modal (easier thumb reach to dismiss/confirm); consider this when reviewing dialogs.
6. **Interruption resilience** — mobile users get interrupted (calls, app-switch) far more than desktop users; multi-step flows (e.g. a travel request form) should tolerate resuming without losing input where feasible.

## HR-domain specifics

This is HR/travel/employee admin tooling — flows like relative management, travel requests, HR staff review queues. These are _trust-sensitive_ and often _irreversible_ (approving a request, deleting a relative record). Any destructive or approval action needs an explicit confirmation step — don't let a single click cause an irreversible HR action. On touch that confirmation must be touch-safe: a full-width "Confirm" button reachable by thumb, not a tiny inline icon easy to mis-tap.

## Output

Identify the specific state/interaction gap (not a generic "add loading states" — name the component/route and which state is missing), and propose the smallest change that closes it. For a touch gap, name the specific flow/component and the concrete pattern to apply — not a generic "make it mobile-friendly" note.
