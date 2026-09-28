---
schemaVersion: 2
id: 0041-fix-dashboard-reject-requests-whose-host-header
title: "fix(dashboard): reject requests whose Host header isn't the server's own address (DNS rebinding)"
label: bug
status: done
priority: medium
size: small
assignedAgent: human
dueDate: 
---

## Context

`litecode dashboard --serve` (ticket 0032, PR #74, ADR 0017) is a read-only local server, listening on `127.0.0.1:4173` by default. The bug-hunter flagged a non-blocking issue, deferred in the PR: the server checks neither the `Host` header nor the HTTP method. A web page open in the browser can use DNS rebinding to make a hostname resolve to 127.0.0.1, then read the dashboard (ticket and ADR contents) from another origin.

## Expected behavior

- Accept a request only if its `Host` names the address the server is listening on (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, or the `--host` passed explicitly). Otherwise answer 403 (or 421) with a short body.
- Accept only `GET` and `HEAD`, and answer 405 to any other method.

## Where

`src/dashboard/serve.ts` (the request handler), with tests in `tests/dashboard/serve.test.ts`: a valid Host, a foreign Host, a missing Host, IPv6, and a non-GET method.

## Also deferred by the bug-hunter (not in this ticket's scope, for the record)

- The `EADDRINUSE` message is misleading when binding fails for another reason.
- A dangling ticket or ADR symlink disappears from `doctor` with no error.
- A microsecond TOCTOU window between realpath and read.

---

generated_by: tracker
task: Host header validation for dashboard serve

### 2026-09-28 — implementer: PR opened, reviewed, ready to merge

PR: https://github.com/woueziou/liteCodeAgent/pull/85 (branch `fix-dashboard-host-header/0041`, base `main`)

Implemented in `src/dashboard/serve.ts`: `rejectUnsafeRequest` runs before any filesystem
access and rejects a request whose method isn't `GET`/`HEAD` (405) or whose `Host` header
isn't in `buildAllowedHosts` — `127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`, and
the explicit `--host` (each with the actual bound port, since `port: 0` only resolves to a
real port after `Bun.serve()` returns). Tests added to `tests/dashboard/serve.test.ts`:
valid Host, foreign Host, missing Host (via a raw HTTP/1.0 socket — `fetch` always sets
Host, and Bun's own HTTP/1.1 handling 400s a request with none before it reaches user
code), IPv6 Host, and a non-GET method.

**reviewer verdict:** `VERDICT: approve`. No blocking findings. Plan fidelity: matches
(single file + tests, no scope creep, correctly left the "also deferred" items out).

**bug-hunter verdict (initial pass):** `HUNT: complete`. Three non-blocking findings:
(1) a wildcard `--host 0.0.0.0`/`--host ::` only allowlists the literal wildcard value,
so LAN clients reaching the server by IP still 403 — deferred, new ticket via triage
(documented below); (2) an explicit `--host` with mixed case never matched the lowercased
Host-header comparison — tagged same-PR fixup, **applied** in commit `b2e67bf`
(`formatHostForHeader` now lowercases), with a new unit test on the exported
`buildAllowedHosts`; (3) the allowlist always requires an explicit port, so a hypothetical
port-80 deployment would reject default-port Host headers — deferred, low value (port 80
needs elevated privileges; default here is 4173). `bun run check` and the full `bun test`
suite (328 pass) were re-run after the mixed-case fix. Both verdicts posted verbatim on
the PR (issue comments 5868287501, 5868287913).

Follow-up not in this ticket's scope (per bug-hunter's REENTRY): a wildcard `--host` bind
can't serve LAN clients under this Host allowlist — worth a ticket deciding between
documenting the limitation or adding the machine's interface addresses to the allowlist
for wildcard binds. Also low-value: the allowlist requiring an explicit port would reject
a default-port (80) deployment.

`bun run check`: pass. `bun test` (full suite): 328 pass, 0 fail. Status moved
`inProgress` → `readyToMerge`.
