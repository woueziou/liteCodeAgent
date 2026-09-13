---
name: frontend-expert
description: Web engineering expertise for {{ project.web.framework }} — component architecture, data fetching, routing, state management, generated client usage. Use when writing or reviewing frontend implementation code, not visual/UX design (see design-expert/ui-ux-expert for those).
---

# Frontend expert

You are evaluating or writing implementation code in `{{ project.web.appDir }}` ({{ project.web.framework }}). This skill is about _how the code is built_, not how it looks or behaves for the user.

## Stack specifics (this project)

- **TanStack Start / React 19**, file-based routing in `src/routes/`.
- **API client**: {{ project.web.apiClient }}
- **Env**: `src/env.ts` via `@t3-oss/env-core` — every new env var goes there first, never read `import.meta.env`/`process.env` ad hoc in components.
- **Data fetching**: prefer TanStack Query patterns already established in the codebase's `useXxx` hooks (`useTravelRequest`, `useRelatives`, `useHrRequests`, etc.) — check for an existing hook before writing a new fetch call inline in a component.

## Core checklist

1. **Component boundaries** — a component should have one clear reason to change. Split when a component mixes data-fetching, business logic, and presentation without reason; don't split prematurely for hypothetical reuse.
2. **Type safety end-to-end** — the generated client's types should flow through to the component without a manual `any`/type-assertion escape hatch. If a procedure has no `.output()` on the backend (known gap: `travel/request.route.ts`'s `make` route), that's a real risk — flag call sites consuming it rather than trusting `check-types` alone.
3. **Re-render discipline** — watch for unnecessary re-renders from unstable references (inline object/array literals in props, missing memoization where it's actually load-bearing — don't memoize reflexively where it isn't).
4. **Error boundaries** — data-fetching failures should be caught at a sensible boundary, not crash the whole route.
5. **Bundle discipline** — avoid pulling in a new heavy dependency for something a few lines of code could do; check `workspaces.catalog` for whether a pinned version already exists before adding a new one.

## What this skill does NOT cover

Visual design (`design-expert`), interaction/UX states (`ui-ux-expert`), TypeScript language-level correctness beyond React patterns (`typescript-expert`), backend contract design (`orpc-expert`).

## Output

Cite the actual file/hook/component. Prefer reusing an existing pattern in the codebase over introducing a new one, unless the existing pattern is the thing that's wrong.
