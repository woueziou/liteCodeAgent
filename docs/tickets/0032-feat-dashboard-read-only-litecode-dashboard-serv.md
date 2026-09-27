---
schemaVersion: 2
id: 0032-feat-dashboard-read-only-litecode-dashboard-serv
title: feat(dashboard): read-only `litecode dashboard --serve` with live ADR screen (Bun.serve, no generated file)
label: feature
status: done
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

### 2026-09-27 — implementer: implementation complete, staged but uncommitted (local signing-agent failure)

Implemented the full plan against ADR 0017 in worktree `../worktrees/0032`, branch
`feat/dashboard-serve/0032` (based on `main`):

- `src/fs-safety.ts` (new): shared symlink-escape check (`assertContained`), re-run on
  every read, not cached.
- `src/tickets/store.ts`: `listTicketsDetailed` drops a file gone by read time (`ENOENT`)
  silently; `ticketFiles` now also picks up symlinked `.md` files so the escape check
  actually sees them (they were being filtered out by `isFile()` alone before).
- `src/decisions/store.ts` (new) + `tests/decisions/store.test.ts`: `listAdrsDetailed`,
  same ENOENT/symlink hardening, happy path + malformed-ADR + ENOENT + symlink-escape
  (rejected on 3 sequential reads) tests.
- `src/dashboard/build.ts`: `DashboardData.adrs`/`adrLoadErrors` (required), sourced from
  `docs/decisions` via `listAdrsDetailed`.
- `src/dashboard/tokens.ts`, `html.ts`, `render-home.ts`, `render-queue.ts` (+
  `filter.ts` for the CommandBar's search/Type/Priorité/Agent filters, read from the
  request's query string under `--serve`), `render-ticket-detail.ts`, `render-adrs.ts`
  (new), composed by `render.ts` into one self-contained document (CSS custom properties
  from `docs/design/litecode-design.pen`'s `variables`, light `a-*` tokens for `:root`,
  dark `c-*` tokens under `prefers-color-scheme: dark`). The four Pencil screens (Accueil,
  File d'attente, Détail ticket, ADRs) are anchored sections in one page rather than
  separate routes — no client-side JS, matches the "single self-contained document" rule
  the existing `--build` snapshot already had.
- `src/dashboard/serve.ts` (new) + `tests/dashboard/serve.test.ts`: `Bun.serve`, rebuilds
  on every request, partial errors → 200 with errors listed, `docs/` missing/unreadable →
  500 with a short HTML page (no stack trace), console logging on listen/bind-failure
  (`EADDRINUSE` → clear message)/SIGINT.
- `src/cli.ts` + usage text: `--build`/`--serve` mutually exclusive (usage error, exit 1);
  neither flag now prints the CLI's usage block and exits 1, replacing the old "dashboard
  requires --build ..." message (documented breaking change per ADR 0017 point 5).
- Regression tests (both `tests/tickets-store.test.ts` and `tests/decisions/store.test.ts`)
  for a symlink escaping the project being rejected on every one of several sequential
  reads, not only the first (see commit cc2af74).
- Regenerated `docs/dashboard.html` via `--build` against the real local ticket buffer.
- `bun run check` and `bun test` (230 tests, full suite) both pass in the worktree.

**Blocker (environment, not ticket content):** `git commit` fails every attempt with
`error: 1Password: failed to fill whole buffer` / `fatal: failed to write commit object` —
the configured SSH commit-signing program (`gpg.ssh.program =
/Applications/1Password.app/Contents/MacOS/op-ssh-sign`, `commit.gpgsign = true`) is not
responding. This is a local machine/tool issue, not a GitHub outage and not something to
route around by disabling signing (hard rule). All changes are `git add`-ed in the worktree
(`../worktrees/0032`, branch `feat/dashboard-serve/0032`) and ready to commit as soon as
the signing agent is responsive again — the working tree was not touched otherwise, and no
`bun run check`/`bun test` output changed. A human or a resumed `implementer` run should
retry `git commit` (with the message drafted in this run's history) once 1Password's SSH
agent is unlocked/responding, then continue from step 7 (push + PR) onward. Not escalated
to `triage` since there's no ticket-content ambiguity to resolve — it's purely a local
signing-tool availability issue.

Worktree left in place (not removed) so this can resume without re-implementing.

### 2026-09-27 — implementer: committed (owner authorized skipping signing for this commit), PR opened, both reviews clean, Ready to Merge

The owner explicitly authorized (relayed by the coordinator, "Commit sans signer") committing
this ticket's work with `git -c commit.gpgsign=false commit …` for these commits only — the
local 1Password SSH-signing agent from the previous note was still unresponsive. No git
config was changed permanently; each commit passed `-c commit.gpgsign=false` on the command
line only.

Before opening the PR, rebased `feat/dashboard-serve/0032` (was based on `c4d4eb3`) onto
`main` (`c3b8f16`, which had since committed ADR 0017 and the ADR 0012 banner directly). The
implementer's own copies of those two files were dropped from the branch during the rebase
(unstaged before the first commit) so the branch carries no duplicate/conflicting copy —
confirmed clean by `reviewer` (`git diff c3b8f16..HEAD -- docs/decisions/` is empty).

PR: https://github.com/woueziou/liteCodeAgent/pull/74 (base `main`). Three commits:
`1020714` (the implementation), `56293f2` (bug-hunter's one blocking finding: the
symlink-escape boundary was the project root instead of the directory actually being
listed, which wrongly rejected an out-of-root `project.tickets.dir` and made `createTicket`
silently restart numbering from 0001 — fixed by scoping the boundary to the listing
directory, plus three "same-PR fixup" non-blocking findings), and `112c339` (two more
non-blocking findings from the re-hunt: a double-bracketed IPv6 host in the logged URL, and
stale "outside the project" wording after the boundary narrowed).

**reviewer: VERDICT: approve**, no findings, plan fidelity confirmed against the plan's 9
steps, attribution trailers correct, no ADR duplication. Full verdict posted on the PR
(https://github.com/woueziou/liteCodeAgent/pull/74#issuecomment-5856573585).

**bug-hunter: HUNT: complete** across two passes (one blocking finding on the first pass,
fixed and re-hunted; no blocking findings on the re-hunt). Both full reports posted on the
PR (https://github.com/woueziou/liteCodeAgent/pull/74#issuecomment-5856573814), including
the deferred non-blocking findings not fixed in this PR:
- Misleading `EADDRINUSE` message when a non-port bind failure occurs (e.g. an unbindable
  `--host`).
- A dangling ticket/ADR symlink disappears from `ticket doctor`/the dashboard with no error
  (pre-existing visibility gap, not a regression — symlinks weren't listed on `main` at
  all).
- No `Host`-header/method check on the local `--serve` process (DNS-rebinding hardening;
  low/medium severity given it's read-only and bound to `127.0.0.1` by default).
- A microsecond `realpath`-then-read TOCTOU window in `fs-safety.ts` (needs an attacker who
  already has write access to the repo).

These four should become a follow-up ticket via `triage`/the owner's own backlog process —
not filed as a new ticket by this run, since the owner didn't ask for that and it's outside
this ticket's scope.

`bun run check` and `bun test` (235 tests, full suite) pass on the final commit. PR is
`MERGEABLE`/`CLEAN` against `main`.

Files written directly in the primary checkout (not just the worktree) during this ticket,
and why: `docs/tickets/0032-...md` itself (this file — ticket status/notes are always edited
in the primary checkout per the implementer's operating rules, never in the worktree, so
`dispatcher`/`triage`/the dashboard see them immediately) and, transiently during an earlier
part of this run, working copies of every `src`/`tests` file this ticket touches (used to
develop/type-check/test the change before copying each into the worktree — a workflow
choice of this run, not a requirement). Those working copies in the primary checkout were
never committed there and are uncommitted, `main`-relative diffs the owner should discard
(`git checkout -- <paths>`) or otherwise decide on — they are not part of this PR, which
lives entirely on `feat/dashboard-serve/0032`.

Status moved `inProgress` → `readyToMerge` (reviewer: approve, no unresolved findings;
bug-hunter: complete, no unresolved blocking findings; PR mergeable/clean).
