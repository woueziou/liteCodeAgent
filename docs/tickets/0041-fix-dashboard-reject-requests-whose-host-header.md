---
schemaVersion: 2
id: 0041-fix-dashboard-reject-requests-whose-host-header
title: fix(dashboard): reject requests whose Host header isn't the server's own address (DNS rebinding)
label: bug
status: backlog
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
