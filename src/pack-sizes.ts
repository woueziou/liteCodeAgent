/**
 * Token control by words (ticket 0089, ADR 0025): the size of each agent, skill and reference file
 * of every pack, a non-blocking drift report against a committed snapshot, and the cap check used
 * by `bun test`. Sizes are RENDERED words (what the model reads: frontmatter and template output
 * included), keyed `<pack>/<rel>`, measured with the install rendering path (`buildPlan`) against a
 * fixed project config so the numbers do not depend on any one project.
 */

import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { ConfigSchema, type Config } from "./config.ts";
import { buildPlan } from "./install.ts";
import { listPacks, loadPack } from "./packs.ts";

/** Words per file keyed `<pack>/<rel>`: the unit of the snapshot and of the caps. */
export type Sizes = Record<string, number>;

/** A file's size: rendered words (what the model reads) and source words (informational). */
export type Measure = { rendered: number; source: number };

/** Growth over the previous size, in percent, above which the report warns. */
export const DRIFT_THRESHOLD_PERCENT = 10;

/** The fixed project config the baseline was measured with (docs/specs/restructure-baseline/). */
export const BASELINE_CONFIG_PATH = join(import.meta.dir, "..", "docs", "specs", "restructure-baseline", "litecode.config.json");

/** The `project.web` block the web pack's skills interpolate; fixed so rendered sizes are stable. */
const WEB_CONFIG = {
  appDir: "apps/web",
  framework: "React 19",
  apiClient: "generated client",
  typeSourceOfTruth: "shared schemas",
  typecheck: "bun run check",
  styling: "Tailwind",
};

const COUNTED = /^(agents\/[^/]+\.md|skills\/[^/]+\/SKILL\.md|reference\/[^/]+\.md)$/;

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

export async function loadBaselineConfig(): Promise<Config> {
  return ConfigSchema.parse(await Bun.file(BASELINE_CONFIG_PATH).json());
}

/** Every pack `name` needs installed with it, itself last. */
async function withRequired(packsRoot: string, name: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (n: string) => {
    if (out.includes(n)) return;
    for (const r of (await loadPack(packsRoot, n)).manifest.requires) await visit(r);
    out.push(n);
  };
  await visit(name);
  return out;
}

/**
 * Renders each pack through the install path and measures its agents, skills and references.
 * Skills marked `install: referenced` render only when something asks for them, so a second
 * pass lists every skill in a domain rule, to give each one a rendered size.
 */
export async function measurePackSizes(packsRoot: string, base?: Config): Promise<Record<string, Measure>> {
  const baseConfig = base ?? (await loadBaselineConfig());
  const noProject = join(tmpdir(), "litecode-sizes-no-project");
  const sizes: Record<string, Measure> = {};
  for (const name of await listPacks(packsRoot)) {
    const pack = await loadPack(packsRoot, name);
    const sources = new Map(pack.files.filter((f) => COUNTED.test(f.rel)).map((f) => [f.rel, f.source]));
    const skillNames = [...sources.keys()].flatMap((rel) => /^skills\/([^/]+)\/SKILL\.md$/.exec(rel)?.[1] ?? []);
    const config: Config = {
      ...baseConfig,
      target: "claude-code",
      targets: ["claude-code"],
      packs: await withRequired(packsRoot, name),
      project: { ...baseConfig.project, web: baseConfig.project.web ?? WEB_CONFIG },
    };
    const wantAll: Config = {
      ...config,
      project: { ...config.project, domains: [...config.project.domains, { match: "all skills", skills: skillNames }] },
    };
    // Files marked `install: handoff` (the closer and its references) exist only where the handoff is on:
    // a last pass turns it on for claude-code so they get a size and a cap too (ADR 0027). Files already
    // measured keep their default-render size, which is what every default install reads.
    const withHandoff: Config = { ...config, project: { ...config.project, handoff: "auto", handoffSupport: { "claude-code": true } } };
    for (const cfg of skillNames.length ? [config, wantAll, withHandoff] : [config, withHandoff]) {
      for (const entry of (await buildPlan(noProject, packsRoot, cfg)).entries) {
        if (entry.pack !== name || entry.harness !== "claude-code") continue;
        const rel = entry.rel.slice(`${cfg.outDir}/`.length);
        const key = `${name}/${rel}`;
        const source = sources.get(rel);
        if (source !== undefined && !sizes[key]) sizes[key] = { rendered: countWords(entry.content), source: countWords(source) };
      }
    }
  }
  return sizes;
}

/** The rendered words alone: the shape of the snapshot and of the cap table. */
export const renderedWords = (measures: Record<string, Measure>): Sizes =>
  Object.fromEntries(Object.entries(measures).map(([file, m]) => [file, m.rendered]));

/** Problems found when rendered sizes are held against a cap table; empty when all is well. */
export function checkCaps(sizes: Sizes, caps: Record<string, number>): string[] {
  const problems: string[] = [];
  const where = "tests/pack-word-caps.test.ts (ADR 0025)";
  for (const [file, words] of Object.entries(sizes)) {
    const cap = caps[file];
    if (cap === undefined) problems.push(`${file}: ${words} rendered words and no cap in the table; add a row in ${where}`);
    else if (words > cap) problems.push(`${file}: ${words} rendered words, cap ${cap}; if the growth is intended, raise it in ${where}`);
  }
  for (const file of Object.keys(caps)) {
    if (!(file in sizes)) problems.push(`${file}: cap for a file that does not exist; remove the row in ${where}`);
  }
  return problems;
}

export type DriftRow = {
  file: string;
  /** Rendered words now; undefined when the file is gone. */
  now?: number;
  /** Source words now, informational. */
  source?: number;
  /** Rendered words in the snapshot; undefined for a new file. */
  before?: number;
  /** Change since the snapshot, in percent; undefined when either side is missing or the snapshot size is 0. */
  percent?: number;
  warn: boolean;
};

export function compareSizes(now: Record<string, Measure>, before: Sizes, thresholdPercent = DRIFT_THRESHOLD_PERCENT): DriftRow[] {
  const files = [...new Set([...Object.keys(now), ...Object.keys(before)])].sort();
  return files.map((file) => {
    const measure = now[file];
    const renderedNow = measure?.rendered;
    const recorded = before[file];
    const percent =
      renderedNow !== undefined && recorded !== undefined && recorded > 0 ? ((renderedNow - recorded) / recorded) * 100 : undefined;
    return { file, now: renderedNow, source: measure?.source, before: recorded, percent, warn: percent !== undefined && percent > thresholdPercent };
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

/** Plain-text report in rendered words; `warn` rows carry a `!` marker. */
export function formatDriftReport(rows: DriftRow[], hasSnapshot: boolean, thresholdPercent = DRIFT_THRESHOLD_PERCENT): string {
  const width = Math.max(4, ...rows.map((r) => r.file.length));
  const lines = [`${"file".padEnd(width)}  ${"rendered".padStart(8)}  ${"recorded".padStart(8)}  ${"change".padStart(8)}  ${"source".padStart(6)}`];
  for (const r of rows) {
    const rendered = r.now === undefined ? "gone" : String(r.now);
    const recorded = r.before === undefined ? "new" : String(r.before);
    const change = r.percent === undefined ? "" : `${r.percent >= 0 ? "+" : ""}${r.percent.toFixed(1)} %`;
    const source = r.source === undefined ? "" : String(r.source);
    const marker = r.warn ? `  ! over +${thresholdPercent} %` : "";
    lines.push(`${r.file.padEnd(width)}  ${rendered.padStart(8)}  ${recorded.padStart(8)}  ${change.padStart(8)}  ${source.padStart(6)}${marker}`);
  }
  const warned = rows.filter((r) => r.warn).length;
  lines.push("", "Words are rendered (frontmatter and template output included) with the baseline fixture config; source is informational.");
  if (!hasSnapshot) lines.push("No snapshot to compare with; run with --update at release time to record one.");
  else lines.push(warned ? `${warned} file(s) grew by more than ${thresholdPercent} % since the snapshot. Advisory only.` : "No file grew by more than the threshold.");
  return lines.join("\n");
}
