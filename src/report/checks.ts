/** Pure classification of `gh pr checks --json name,bucket` rows (ticket 0059). */

import type { PrChecksLookup } from "./verify.ts";

export type CheckRow = { name: string; bucket: string };

/** `gh pr checks` says this, rather than returning an empty JSON array, on a PR with no checks. */
export const PR_NO_CHECKS = /no checks reported/i;

/** Parses the rows out of `gh`'s stdout; `null` when it isn't the JSON array asked for. */
export function parseCheckRows(stdout: string): CheckRow[] | null {
  try {
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => ({ name: String((r as CheckRow).name ?? ""), bucket: String((r as CheckRow).bucket ?? "") }));
  } catch {
    return null;
  }
}

/**
 * Collapses the rows: any `fail`/`cancel` wins outright, then any still-running (`pending`),
 * then — only if every expected test check has a *passing* row — `pass`. A test check that
 * is absent or merely skipped can't prove the tests ran, so that is `no-test-check`, never
 * `pass`. No rows at all is `none`. An empty `expected` list turns the requirement off.
 */
export function classifyChecks(rows: CheckRow[], expected: string[]): PrChecksLookup {
  if (rows.length === 0) return { kind: "none" };
  if (rows.some((r) => r.bucket === "fail" || r.bucket === "cancel")) return { kind: "fail" };
  if (rows.some((r) => r.bucket === "pending")) return { kind: "pending" };
  const passed = new Set(rows.filter((r) => r.bucket === "pass").map((r) => r.name.toLowerCase()));
  if (expected.every((name) => passed.has(name.toLowerCase()))) return { kind: "pass" };
  return { kind: "no-test-check", expected, ran: [...new Set(rows.map((r) => r.name))] };
}
