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

## HR-domain specifics

This is HR/travel/employee admin tooling — flows like relative management, travel requests, HR staff review queues. These are _trust-sensitive_ and often _irreversible_ (approving a request, deleting a relative record). Any destructive or approval action needs an explicit confirmation step — don't let a single click cause an irreversible HR action.

## Output

Identify the specific state/interaction gap (not a generic "add loading states" — name the component/route and which state is missing), and propose the smallest change that closes it.
