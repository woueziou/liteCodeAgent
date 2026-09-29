---
generated_by: claude
task: "0032"
updated_by: implementer
updated_task: "0052"
---

# 0017. A read-only local server shows the dashboard live

Status: proposed
Date: 2026-09-27

## Context

ADR 0012 §3 made the dashboard a file built only on command: `litecode dashboard --build`
writes `docs/dashboard.html`, which is committed. There is no server and no watcher. The
accepted cost was that the file goes stale as soon as a ticket changes.

The owner now wants the dashboard to reflect the real state of `docs/tickets/` at any
moment. They also want it redesigned from `docs/design/litecode-design.pen`, which has four
screens: the queue, ticket detail, home, and ADRs (ticket 0032). The ADR screen needs
`docs/decisions/`, which the dashboard doesn't read today.

## Decision

1. **`litecode dashboard --serve` starts a local, read-only server** (`Bun.serve`). On every
   request it re-reads `docs/tickets/` and `docs/decisions/` and renders the page, so no
   generated file is involved. It never writes to the repo.
2. **`--build` stays**, along with the committed `docs/dashboard.html`, as a snapshot you can
   browse on GitHub (owner's choice). Both modes share `buildDashboard` and the renderer, so
   the snapshot and the live page are the same page. The snapshot can still go stale, as
   ADR 0012 accepted. Only the server is live.
3. **`--build` and `--serve` are mutually exclusive.** Passing both is a usage error with a
   message naming both flags, and exit code 1.
4. **`--serve` takes `--port` (default `4173`) and `--host` (default `127.0.0.1`).** The
   server listens only on the local machine unless the user passes another host.
5. **`litecode dashboard` with neither flag prints its usage** and exits 1. This replaces
   the "dashboard requires --build …" message. Anything matching on the old text breaks,
   and the release notes say so.
6. **`DashboardData` gains required `adrs` and `adrLoadErrors` fields.** The module still
   describes the current state only. It covers ADRs as well now, and still keeps no time
   series (ADR 0012, open question B).
7. **Errors split in two:**
   - **Partial:** some ticket or ADR files are unreadable or invalid. The server answers
     200 and the page lists the failures, as the dashboard already does for tickets.
   - **Fatal:** `docs/` is missing or unreadable. The server answers 500 with a short HTML
     error page, never a stack trace.

   A ticket or ADR file that disappears between listing the folder and reading it is left
   out silently. It was being deleted or rewritten, which is not an error.
8. **Symlink protection applies on every request.** A file in `docs/tickets/` or
   `docs/decisions/` that resolves outside the project is rejected on every read, not only
   the first.
9. **The server logs with `console.log`/`console.error`,** as the rest of the CLI does, at
   three moments:
   - once listening, with its address;
   - if it can't bind: a clear message (e.g. port already in use) and exit code 1;
   - on Ctrl-C (SIGINT): it stops and exits 0.

## Consequences

- This supersedes ADR 0012 §3's "no server" clause. The explicit, committed build it
  describes stays, alongside the server.
- A live view needs a running process. Anyone who doesn't start the server still reads
  a snapshot.
- The ADRs become part of what the dashboard shows. A malformed ADR file now shows up
  as an error on the dashboard instead of going unnoticed.

## 2026-09-29 — amendment (ticket 0052): `--allow-host` widens point 4's allow-list

Point 4's Host allow-list (ticket 0041) was `127.0.0.1`, `localhost`, `[::1]`, and the bound
`--host`, each with the bound port. Launched with `--host 0.0.0.0` or `::` to be reached from
another machine, every real request 403'd: the browser sends the machine's actual IP or name
in `Host`, which was never in that set (non-blocking bug-hunter finding on PR #85).

The allow-list now also accepts:

- Any number of `--allow-host <name[:port]>` entries (repeatable), and/or the equivalent
  `project.dashboard.allowedHosts` config array — merged together, not one replacing the
  other. Each entry names one exact host, with an optional explicit port; without a port it
  falls back to whatever port the server is bound to. **No wildcard is ever accepted** — an
  entry containing `*` is a startup error, not silently ignored — so the DNS-rebinding
  protection point 4 exists for stays intact: only hosts the owner explicitly opted in are
  served, never an implicit "every IP".
- A bare hostname (no port) is accepted, for any allowed host including the fixed ones,
  wherever the *port that entry resolves to* is 80 — the default HTTP port a browser's
  `Host` header omits. That resolved port is either the port the entry itself names
  explicitly (`--allow-host proxy.example:80` also accepts a bare `proxy.example`, e.g.
  behind a reverse proxy that terminates on :80 regardless of what port this process is
  bound to), or, when the entry gives no port of its own, the port this server is actually
  bound to. Anywhere else, a bare hostname with no port is never matched.
- Binding to `0.0.0.0`/`::` with no `--allow-host` at all still works exactly as before (only
  the fixed local addresses are served), but now prints a startup warning explaining that
  only local requests will pass and how to allow another host.

Point 4 itself is otherwise unchanged: the default remains `127.0.0.1`, and nothing here
weakens what counts as a match — it only adds more entries an operator has to name
explicitly to the same exact-match check.
