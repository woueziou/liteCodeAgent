/**
 * Reading `docs/decisions/` (ADR files, `NNNN-kebab-title.md`) for the dashboard's ADR
 * screen (ticket 0032, ADR 0017). Mirrors `src/tickets/store.ts`'s hardening: a file
 * deleted between listing the directory and reading it (`ENOENT`) is dropped silently, a
 * symlink resolving outside the project is rejected on every read (`fs-safety.ts`), and a
 * malformed file is reported as a load error rather than throwing for every other ADR.
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseFrontmatter } from "../frontmatter.ts";
import { assertContained } from "../fs-safety.ts";

export type AdrSummary = {
  /** e.g. "0017" from "0017-read-only-dashboard-server-supersedes-committed-build.md" */
  id: string;
  slug: string;
  title: string;
  status: string;
  date: string;
  path: string;
  body: string;
};

export type AdrLoadError = { path: string; error: string };

export type AdrListing = { adrs: AdrSummary[]; errors: AdrLoadError[] };

const ADR_FILENAME = /^(\d{4})-([a-z0-9-]+)\.md$/;

/** Header line convention used by every ADR: `# 0017. Some title`. */
function parseHeading(body: string, id: string, where: string): string {
  const match = body.match(/^#\s*\d{4}\.\s*(.+)$/m);
  if (!match) throw new Error(`${where}: missing '# ${id}. <title>' heading`);
  return match[1]!.trim();
}

function parseField(body: string, name: string, where: string): string {
  const match = body.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  if (!match) throw new Error(`${where}: missing '${name}: ...' line`);
  return match[1]!.trim();
}

export function adrsDir(root: string, dir: string): string {
  return resolve(root, dir);
}

async function adrFiles(abs: string): Promise<string[]> {
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries
      .filter((e) => (e.isFile() || e.isSymbolicLink()) && ADR_FILENAME.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/**
 * Parses every ADR file in `dir`. Returns summaries sorted by id, newest first, so the
 * dashboard's ADR list shows recent decisions at the top.
 */
export async function listAdrsDetailed(root: string, dir: string): Promise<AdrListing> {
  const abs = adrsDir(root, dir);
  const adrs: AdrSummary[] = [];
  const errors: AdrLoadError[] = [];
  for (const file of await adrFiles(abs)) {
    const path = join(dir, file);
    const fileAbs = join(abs, file);
    const match = file.match(ADR_FILENAME)!;
    const [, id, slug] = match as unknown as [string, string, string];
    try {
      const realAbs = await assertContained(fileAbs, abs);
      const source = await Bun.file(realAbs).text();
      const { body } = parseFrontmatter(source, path);
      const title = parseHeading(body, id, path);
      const status = parseField(body, "Status", path);
      const date = parseField(body, "Date", path);
      adrs.push({ id, slug, title, status, date, path, body });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      errors.push({ path, error: (e as Error).message });
    }
  }
  adrs.sort((a, b) => b.id.localeCompare(a.id));
  return { adrs, errors };
}
