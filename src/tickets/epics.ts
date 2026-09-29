/**
 * Epics are plain directories `docs/tickets/NN-name/` (ADR 0012 section 2). Pure helpers
 * to parse and pick epic directory names, plus the one filesystem read that lists them.
 */

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { slugify } from "./spec.ts";

const EPIC_DIR = /^(\d{2,})-(.+)$/;

/** Splits `07-resilience` into its number and name; a bare name has no number. */
export function parseEpicName(dirName: string): { number: number | null; name: string } {
  const m = EPIC_DIR.exec(dirName);
  return m ? { number: Number(m[1]), name: m[2]! } : { number: null, name: dirName };
}

/** Epic directory names (not paths) directly under the tickets directory. */
export async function listEpicDirs(root: string, dir: string): Promise<string[]> {
  try {
    const entries = await readdir(resolve(root, dir), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && EPIC_DIR.test(e.name)).map((e) => e.name).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/**
 * Picks the directory name for `--epic <input>`: reuses an existing epic whose name
 * (prefix stripped) matches, otherwise builds `NN-name` with the next free number, or the
 * caller's own prefix when given. The name always goes through `slugify`, so path
 * separators and `..` can never reach the filesystem.
 */
export function chooseEpicDir(existing: string[], input: string): string {
  const parsed = parseEpicName(input.trim());
  const name = slugify(parsed.name);
  const match = existing.find((d) => parseEpicName(d).name === name);
  if (match) return match;
  const highest = existing.reduce((max, d) => Math.max(max, parseEpicName(d).number ?? 0), 0);
  const number = parsed.number ?? highest + 1;
  return `${String(number).padStart(2, "0")}-${name}`;
}
