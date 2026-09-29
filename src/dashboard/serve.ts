/**
 * `litecode dashboard --serve` (ADR 0017): a local, read-only `Bun.serve` process. Every
 * request re-reads `docs/tickets/` and `docs/decisions/` (via `buildDashboard`) and renders
 * the page fresh — no generated file, no cache, no write path back to the repo.
 *
 * Error handling (ADR 0017 point 7):
 * - Partial: some ticket/ADR files are unreadable or invalid — `buildDashboard` already
 *   tolerates this (`loadErrors`/`adrLoadErrors`), so the response is 200 and the page
 *   lists the failures.
 * - Fatal: the tickets directory's parent (`docs/`) is missing or unreadable — the whole
 *   buffer can't be located, so the response is 500 with a short HTML page, never a stack
 *   trace.
 *
 * Request validation (ticket 0041, DNS rebinding hardening): a web page open in the
 * browser can make a hostname resolve to 127.0.0.1 via DNS rebinding and then send
 * same-origin-looking requests to this server from another origin. `Bun.serve` (like most
 * local dev servers) doesn't check the `Host` header on its own, so every request is
 * checked against the address this server actually listens on before it touches the
 * filesystem: only `GET`/`HEAD` are accepted (405 otherwise), and only a `Host` naming
 * `127.0.0.1`, `localhost`, `[::1]`, the explicit `--host`, or one of any `--allow-host`
 * entries (each with the bound port, or without one when it's port 80) is accepted (403
 * otherwise). `--allow-host` never accepts a wildcard — every entry names one exact host
 * (ticket 0052, ADR 0017 amendment).
 */

import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDashboard } from "./build.ts";
import { renderDashboard } from "./render.ts";
import { filterFromSearchParams } from "./filter.ts";

export type ServeOptions = { port?: number; host?: string; allowHosts?: string[] };

export const DEFAULT_PORT = 4173;
export const DEFAULT_HOST = "127.0.0.1";

function fatalErrorPage(message: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><title>Dashboard — erreur</title></head>
<body>
  <h1>Le dashboard n'a pas pu se construire</h1>
  <p>${message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p>
</body>
</html>`;
}

/**
 * Whether `docs/` (the parent of the tickets dir) exists and is readable at all — the
 * fatal/partial split from ADR 0017. A missing or unreadable ticket/ADR *file* is partial
 * (handled inside `buildDashboard`); a missing or unreadable `docs/` directory itself is
 * fatal, since neither tickets nor ADRs can be located at all.
 */
async function docsRootReadable(root: string, dir: string): Promise<boolean> {
  try {
    await stat(resolve(root, dirname(dir)));
    return true;
  } catch {
    return false;
  }
}

const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

function shortTextResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * `host` (bound or explicitly requested) formatted the way it appears in a `Host` header:
 * an IPv6 literal is bracketed, anything else is left as-is. Strips any brackets already
 * present first so re-bracketing an already-bracketed host (e.g. `--host [::1]`) doesn't
 * double up.
 */
function formatHostForHeader(host: string): string {
  // Lowercased to match the lowercased comparison in `rejectUnsafeRequest`: an explicit
  // `--host` with any uppercase (a mixed-case hostname, or an uppercase-hex IPv6 literal
  // like `FE80::1`) would otherwise never match the header it's meant to allow
  // (bug-hunter finding, PR #85).
  const stripped = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return stripped.includes(":") ? `[${stripped}]` : stripped;
}

/**
 * Splits an `--allow-host` entry into a host and an optional explicit port: `name:port` or
 * `[::1]:port` carry their own port; a bare `name` (or bracketed IPv6 literal with no port)
 * falls back to the server's bound port when added to the allow-list (ticket 0052).
 */
function parseAllowedHostEntry(entry: string): { host: string; port?: number } {
  const bracketedWithPort = entry.match(/^(\[[0-9a-fA-F:]+\]):(\d+)$/);
  if (bracketedWithPort) return { host: bracketedWithPort[1]!, port: Number(bracketedWithPort[2]) };
  if (/^\[[0-9a-fA-F:]+\]$/.test(entry)) return { host: entry };

  // An unbracketed IPv6 literal (more than one colon, e.g. `fe80::1` or `2001:db8::8080`) has
  // no unambiguous port suffix — the last ":8080" could be the port or the last hex group —
  // so it's treated as the whole host with no port, rather than mis-split at the last colon
  // (bug-hunter finding on this PR: `--allow-host fe80::1` used to parse as host `fe80:`
  // port `1`, silently never matching any real request).
  const colonCount = (entry.match(/:/g) ?? []).length;
  if (colonCount > 1) return { host: entry };

  const lastColon = entry.lastIndexOf(":");
  if (lastColon !== -1 && /^\d+$/.test(entry.slice(lastColon + 1))) {
    return { host: entry.slice(0, lastColon), port: Number(entry.slice(lastColon + 1)) };
  }
  return { host: entry };
}

/**
 * The set of `Host` header values this server accepts for a given bound port: the fixed
 * local addresses named in ticket 0041 (`127.0.0.1`, `localhost`, `[::1]`), whichever host
 * the server was actually told to bind (covers an explicit `--host` other than the default,
 * e.g. a LAN address the owner opted into), plus any `--allow-host` entries (ticket 0052) —
 * no wildcard is ever accepted here, only exact host[:port] names the caller opted in.
 *
 * Each host is added with its port (the entry's own, or the server's bound port when none
 * is given), and — when that port is 80, the default HTTP port — also without a port, since
 * a browser omits `:80` from the `Host` header it sends.
 */
export function buildAllowedHosts(port: number, boundHost: string, additionalHosts: string[] = []): Set<string> {
  const hosts = new Set<string>();
  const addHost = (name: string, explicitPort?: number) => {
    const formatted = formatHostForHeader(name);
    const resolvedPort = explicitPort ?? port;
    hosts.add(`${formatted}:${resolvedPort}`);
    if (resolvedPort === 80) hosts.add(formatted);
  };

  addHost("127.0.0.1");
  addHost("localhost");
  addHost("[::1]");
  addHost(boundHost);
  for (const entry of additionalHosts) {
    const { host, port: entryPort } = parseAllowedHostEntry(entry);
    addHost(host, entryPort);
  }
  return hosts;
}

/**
 * Whether `host` (as passed to `--host`/`Bun.serve`) binds every interface, so no `Host`
 * header can name it literally — without an explicit `--allow-host`, only requests from the
 * local machine itself will ever match the allow-list (ticket 0052). Normalizes brackets and
 * case first and recognizes the all-zeros IPv6 spellings too (`::`, `0:0:0:0:0:0:0:0`, `::0`,
 * `0.0.0.0`), not just the two literal strings the original check compared against
 * (bug-hunter finding on this PR: `--host ::0` bound every interface but printed no warning).
 */
export function isWildcardBindHost(host: string): boolean {
  const stripped = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  // `0` is the shorthand inet_aton accepts for 0.0.0.0; `::ffff:0.0.0.0` is its IPv4-mapped form.
  if (stripped === "0.0.0.0" || stripped === "0" || stripped === "::ffff:0.0.0.0") return true;
  if (!stripped.includes(":")) return false;
  const groups = stripped.split(":");
  return groups.every((g) => g === "" || /^0+$/.test(g));
}

/**
 * Rejects a request whose method isn't read-only, or whose `Host` header doesn't name this
 * server's own address — DNS rebinding hardening, ticket 0041. Returns `null` when the
 * request passes both checks. Checked before any filesystem access.
 */
function rejectUnsafeRequest(req: Request, allowedHosts: Set<string>): Response | null {
  const method = req.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return shortTextResponse(405, "method not allowed — only GET and HEAD are served");
  }

  const host = req.headers.get("host");
  if (!host || !allowedHosts.has(host.toLowerCase())) {
    return shortTextResponse(403, "forbidden — Host header doesn't match this server's address");
  }

  return null;
}

async function handleRequest(root: string, dir: string, req: Request, allowedHosts: Set<string>): Promise<Response> {
  const rejection = rejectUnsafeRequest(req, allowedHosts);
  if (rejection) return rejection;

  if (!(await docsRootReadable(root, dir))) {
    return new Response(fatalErrorPage(`Le répertoire des documents ('${dirname(dir)}') est introuvable ou illisible.`), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  try {
    const url = new URL(req.url);
    const filter = filterFromSearchParams(url.searchParams);
    const data = await buildDashboard(root, dir);
    const html = renderDashboard(data, filter);
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    // The page never shows this (no stack trace to the client, ADR 0017), but swallowing
    // it entirely left the server console silent too — the only place left to diagnose an
    // ELOOP/EACCES/etc from a bad entry under docs/tickets or docs/decisions.
    console.error("dashboard: request failed", e);
    return new Response(fatalErrorPage("Erreur inattendue lors de la construction du dashboard."), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}

export type DashboardServer = { stop: () => void; url: string };

/**
 * Starts the read-only dashboard server. Resolves once listening; logs on bind, on bind
 * failure (`EADDRINUSE` gets a clear message, exit code 1 handled by the caller — this
 * function itself throws so the caller can decide the process exit), and registers a SIGINT
 * handler that stops the server and exits 0.
 */
export async function startDashboardServer(root: string, dir: string, options: ServeOptions = {}): Promise<DashboardServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const allowHosts = options.allowHosts ?? [];

  if (isWildcardBindHost(host) && allowHosts.length === 0) {
    console.warn(
      `dashboard: listening on ${host} but no --allow-host was given — only requests whose Host header names ` +
        "127.0.0.1, localhost or [::1] will be served (DNS-rebinding protection, ADR 0017). " +
        "To let another machine's browser through, pass --allow-host <name[:port]> for the address it will connect with.",
    );
  }

  // Populated right after `Bun.serve` returns, before any request can reach `fetch` — the
  // actual bound port (relevant when `port: 0` asks for an ephemeral one) is only known
  // then. `fetch` captures this variable by reference, so the later assignment is visible.
  let allowedHosts: Set<string> = new Set();

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname: host,
      fetch: (req) => handleRequest(root, dir, req, allowedHosts),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") {
      throw new Error(`port ${port} is already in use — pass --port to use a different one`);
    }
    throw e;
  }

  // Built from the actual bound socket rather than the requested host/port: Bun clamps an
  // out-of-range port and formats an IPv6 host without brackets, so echoing the request
  // back verbatim could log a URL that doesn't match what's actually listening.
  const boundHostname = server.hostname ?? host;
  const boundHost =
    boundHostname.includes(":") && !boundHostname.startsWith("[") ? `[${boundHostname}]` : boundHostname;
  const url = `http://${boundHost}:${server.port}`;
  allowedHosts = buildAllowedHosts(server.port ?? port, host, allowHosts);
  console.log(`dashboard listening on ${url}`);
  console.log(`dashboard allowed hosts: ${[...allowedHosts].join(", ")}`);

  const onSigint = () => {
    console.log("stopping dashboard server");
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", onSigint);

  return {
    url,
    stop: () => {
      process.off("SIGINT", onSigint);
      server.stop();
    },
  };
}
