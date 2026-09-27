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
 */

import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDashboard } from "./build.ts";
import { renderDashboard } from "./render.ts";
import { filterFromSearchParams } from "./filter.ts";

export type ServeOptions = { port?: number; host?: string };

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

async function handleRequest(root: string, dir: string, req: Request): Promise<Response> {
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
  } catch {
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

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      hostname: host,
      fetch: (req) => handleRequest(root, dir, req),
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") {
      throw new Error(`port ${port} is already in use — pass --port to use a different one`);
    }
    throw e;
  }

  const url = `http://${host}:${port}`;
  console.log(`dashboard listening on ${url}`);

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
