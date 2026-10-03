/**
 * Token control by words (ticket 0089, ADR 0025): the size of each agent and skill of every pack,
 * a non-blocking drift report against a committed snapshot, and the cap check used by `bun test`.
 * Sizes are word counts of the pack source files, keyed `<pack>/<rel>`.
 */

import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { listPacks, loadPack } from "./packs.ts";

export type Sizes = Record<string, number>;

/** Growth over the previous size, in percent, above which the report warns. */
export const DRIFT_THRESHOLD_PERCENT = 10;

const AGENT_OR_SKILL = /^(agents\/[^/]+\.md|skills\/[^/]+\/SKILL\.md)$/;

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export async function measurePackSizes(packsRoot: string): Promise<Sizes> {
  const sizes: Sizes = {};
  for (const name of await listPacks(packsRoot)) {
    const pack = await loadPack(packsRoot, name);
    for (const f of pack.files) if (AGENT_OR_SKILL.test(f.rel)) sizes[`${name}/${f.rel}`] = countWords(f.source);
  }
  return sizes;
}

/** Problems found when sizes are held against a cap table; empty when all is well. */
export function checkCaps(sizes: Sizes, caps: Record<string, number>): string[] {
  const problems: string[] = [];
  for (const [file, words] of Object.entries(sizes)) {
    const cap = caps[file];
    if (cap === undefined) problems.push(`${file}: no cap in the table`);
    else if (words > cap) problems.push(`${file}: ${words} words, cap ${cap}`);
  }
  for (const file of Object.keys(caps)) if (!(file in sizes)) problems.push(`${file}: cap for a file that does not exist`);
  return problems;
}

export type DriftRow = { file: string; now?: number; before?: number; warn: boolean };

export function compareSizes(now: Sizes, before: Sizes, thresholdPercent = DRIFT_THRESHOLD_PERCENT): DriftRow[] {
  const files = [...new Set([...Object.keys(now), ...Object.keys(before)])].sort();
  return files.map((file) => {
    const n = now[file];
    const b = before[file];
    const warn = n !== undefined && b !== undefined && b > 0 && ((n - b) / b) * 100 > thresholdPercent;
    return { file, now: n, before: b, warn };
  });
}

export async function readSnapshot(path: string): Promise<Sizes | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? ((await file.json()) as Sizes) : undefined;
}

export async function writeSnapshot(path: string, sizes: Sizes): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(sizes, null, 2) + "\n");
}

/** Plain-text report; `warn` rows carry a `!` marker. */
export function formatDriftReport(rows: DriftRow[], hasSnapshot: boolean, thresholdPercent = DRIFT_THRESHOLD_PERCENT): string {
  const width = Math.max(4, ...rows.map((r) => r.file.length));
  const lines = [`${"file".padEnd(width)}  ${"now".padStart(6)}  ${"before".padStart(6)}  change`];
  for (const r of rows) {
    const now = r.now === undefined ? "gone" : String(r.now);
    const before = r.before === undefined ? "new" : String(r.before);
    const change =
      r.now !== undefined && r.before !== undefined && r.before > 0
        ? `${r.now - r.before >= 0 ? "+" : ""}${(((r.now - r.before) / r.before) * 100).toFixed(1)} %`
        : "";
    lines.push(`${r.file.padEnd(width)}  ${now.padStart(6)}  ${before.padStart(6)}  ${change}${r.warn ? `  ! over +${thresholdPercent} %` : ""}`);
  }
  const warned = rows.filter((r) => r.warn).length;
  lines.push("");
  if (!hasSnapshot) lines.push("No snapshot to compare with; run with --update at release time to record one.");
  else lines.push(warned ? `${warned} file(s) grew by more than ${thresholdPercent} % since the snapshot. Advisory only.` : "No file grew by more than the threshold.");
  return lines.join("\n");
}
