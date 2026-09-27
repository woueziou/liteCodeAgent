/**
 * Symlink-escape protection shared by every store that reads a directory of user-editable
 * files (`docs/tickets/`, `docs/decisions/`). A symlink placed inside one of those
 * directories can point anywhere on disk; without a check, listing/reading it would read
 * (or, worse, a future write path could write) outside the project. The check must run on
 * every read, not just the first: a symlink can be swapped after an initial "looks fine"
 * check (TOCTOU), and a long-lived `--serve` process re-reads the directory on every
 * request, so caching the result of one check across requests would silently stop
 * protecting later ones (see commit cc2af74's regression on a related check).
 */

import { realpath } from "node:fs/promises";
import { sep } from "node:path";

export class PathEscapeError extends Error {
  constructor(public readonly path: string) {
    super(`refusing to read '${path}': it resolves outside the project`);
    this.name = "PathEscapeError";
  }
}

/**
 * Resolves `abs` (following symlinks) and throws `PathEscapeError` if the result doesn't
 * stay inside `boundary`. Returns the resolved real path so callers can read that instead
 * of the original (still-a-symlink) path, closing the TOCTOU window between this check and
 * the actual read as tightly as `fs/promises` allows.
 *
 * `boundary` must be the directory actually being listed (e.g. the tickets dir, the
 * decisions dir) — never the project root. `project.tickets.dir` (and the ADR dir) is a
 * config value a project can legitimately point outside the repo root (a shared ticket
 * buffer symlinked in from elsewhere); rejecting that wholesale would silently empty the
 * whole listing and, worse, make `createTicket` restart numbering from scratch since it
 * reads the (falsely empty) listing to pick the next id. Scoping the boundary to the
 * listing directory itself still blocks the real threat — a symlink *inside* that
 * directory pointing somewhere unexpected — without punishing an intentionally
 * out-of-root directory.
 */
export async function assertContained(abs: string, boundary: string): Promise<string> {
  const realAbs = await realpath(abs);
  const realBoundary = await realpath(boundary);
  if (realAbs !== realBoundary && !realAbs.startsWith(realBoundary + sep)) {
    throw new PathEscapeError(abs);
  }
  return realAbs;
}

export function isPathEscapeError(e: unknown): e is PathEscapeError {
  return e instanceof PathEscapeError;
}
