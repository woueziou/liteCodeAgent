---
schemaVersion: 2
id: 0032-feat-dashboard-read-only-litecode-dashboard-serv
title: feat(dashboard): read-only `litecode dashboard --serve` with live ADR screen (Bun.serve, no generated file)
label: feature
status: inProgress
priority: high
size: large
assignedAgent: human
dueDate: 
---

## Contexte
The owner wants the dashboard redesigned from the Pencil design in `docs/design/litecode-design.pen`. That file is plain JSON, so read it directly; the design tokens are under its `"variables"` key. It defines 4 screens:
- File d'attente: side rail, ticket list, and a CommandBar with search, Type/Priorité/Agent filters, and the active filter.
- Détail ticket: an overlay.
- Accueil: the home page with a floating command.
- ADRs: a list and a detail view, read from `docs/decisions/`.

The dashboard must be dynamic and reflect the real state. The owner has decided this means a local, read-only server, `litecode dashboard --serve` (Bun.serve), that re-reads `docs/tickets/` and `docs/decisions/` on every request. That supersedes ADR 0012 §3. The new ADR is `docs/decisions/0017-read-only-dashboard-server-supersedes-committed-build.md`.

## Plan
1. `src/tickets/store.ts` — in `listTicketsDetailed`, catch `ENOENT` on the per-file read and drop that ticket silently (it was deleted or is mid-write between readdir and read). Every other error still goes into `errors`.
2. `src/decisions/store.ts` (new) — `listAdrsDetailed(root, dir)` parses `NNNN-kebab-title.md` using the same ENOENT hardening, and exports `AdrLoadError`. Tests go first, in `tests/decisions/store.test.ts`: happy path, the ENOENT race, and a malformed ADR.
3. `src/dashboard/build.ts` — add `adrs: AdrSummary[]` and `adrLoadErrors` to `DashboardData`, and update the module doc comment. The scope still covers current state only, with no time series.
4. Rendering for the 4 screens, split into per-screen helpers: `render-queue.ts`, `render-ticket-detail.ts`, `render-home.ts` and `render-adrs.ts`, composed by `render.ts`. CSS tokens come from the pen file's `variables`, and the output stays self-contained with no external request.
5. `src/dashboard/serve.ts` (new) — `startDashboardServer(root, dir, { port, host })`:
   - Rebuild the data on every request.
   - A fatal fs error returns a 5xx with a safe body (no stack trace).
   - Partial load errors still return 200, with the errors shown in the page.
   - Logging uses `console.log`/`console.error`: on bind, on bind failure (`EADDRINUSE`: clear message, non-zero exit), and on SIGINT (clean shutdown, exit 0).
   - Tests go first, in `tests/dashboard/serve.test.ts`.
6. `src/cli.ts` (the dashboard command and the usage text) — implement the flag contract the ADR settles (`--serve`, `--port`/`--host`, how it interacts with `--build`). Replacing the "dashboard requires --build..." message must be documented as a breaking change.
7. Add a regression test showing a symlink escape in `docs/tickets/` or `docs/decisions/` is rejected on every one of several sequential reads, not only on the first (see `cc2af74`).
8. Keep `--build` and the committed `docs/dashboard.html` (ADR 0017): update the module docs to say both modes coexist and share `buildDashboard`/`renderDashboard`, and regenerate the snapshot.
9. Run `bun run check` and `bun test` after each step.

## Decisions (settled in ADR 0017)
`docs/decisions/0017-read-only-dashboard-server-supersedes-committed-build.md` settles the open points; follow it:
- `--build` and the committed `docs/dashboard.html` stay as a snapshot; `--serve` and `--build` are mutually exclusive (usage error, exit 1).
- `--port` defaults to `4173`, `--host` to `127.0.0.1`.
- `litecode dashboard` with no flag prints usage and exits 1; dropping the old "requires --build" message is a documented breaking change.
- `DashboardData.adrs` and `adrLoadErrors` are required.
- Partial load errors: 200, listed in the page. `docs/` missing or unreadable: 500 with a short HTML page, no stack trace.
- Logging through `console.log`/`console.error` on listen, on bind failure (exit 1) and on SIGINT (exit 0).

## Panel
Classifier: large. Angles: correctness, contract, operability. All three returned blocking, with no conflict between them. The synthesizer returned blocked-compatible, with no blocking tension.
