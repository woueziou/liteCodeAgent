/** Filesystem side of `token-report` (ticket 0075): locate and read Claude Code transcripts. */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentTypeFromMeta, aggregateByAgent, instanceStatsFromTranscript, MAIN_AGENT, usageFromTranscript, type AgentUsage, type InstanceRow } from "./aggregate.ts";

/** Claude Code names a project's transcript dir after its absolute path, every non-alphanumeric char becoming `-`. */
export const projectDirName = (projectPath: string): string => resolve(projectPath).replace(/[^a-zA-Z0-9]/g, "-");

export const transcriptsDir = (projectPath: string, home = homedir()): string =>
  join(home, ".claude", "projects", projectDirName(projectPath));

/** Session ids are file stems; reject anything that could escape the transcripts dir. */
const SESSION_ID = /^[A-Za-z0-9_-]+$/;

export async function latestSession(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const sessions = await Promise.all(
    names.filter((n) => n.endsWith(".jsonl")).map(async (n) => ({ id: n.slice(0, -6), mtime: (await stat(join(dir, n))).mtimeMs })),
  );
  return sessions.sort((a, b) => b.mtime - a.mtime || a.id.localeCompare(b.id))[0]?.id;
}

const readOr = (path: string): Promise<string | undefined> => readFile(path, "utf8").catch(() => undefined);


interface SessionFiles {
  readonly main: string;
  /** One entry per `<session>/subagents/*.jsonl`, sorted by file name; `stem` is the name minus `.jsonl`. */
  readonly subs: readonly { stem: string; text: string; meta: string | undefined }[];
}

/** Validates the session id, then reads the main transcript and every sub-agent transcript with its meta. */
async function readSession(dir: string, sessionId: string): Promise<SessionFiles> {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const main = await readOr(join(dir, `${sessionId}.jsonl`));
  if (main === undefined) throw new Error(`no transcript for session ${sessionId} in ${dir}`);
  const subDir = join(dir, sessionId, "subagents");
  const stems = (await readdir(subDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl")).map((n) => n.replace(/\.jsonl$/, "")).sort();
  const subs = await Promise.all(
    stems.map(async (stem) => ({ stem, text: (await readOr(join(subDir, `${stem}.jsonl`))) ?? "", meta: await readOr(join(subDir, `${stem}.meta.json`)) })),
  );
  return { main, subs };
}

/**
 * One row per instance: `main` (the session transcript) plus one per file in
 * `<session>/subagents/` (instance id = file stem minus the `agent-` prefix, i.e. the agentId).
 * Sorted by first call time (see `InstanceStats` for the time semantics); rows without a
 * timestamp go last, ties keep main first then file name (the sort is stable).
 */
export async function instancesForSession(dir: string, sessionId: string): Promise<InstanceRow[]> {
  const { main, subs } = await readSession(dir, sessionId);
  const rows: InstanceRow[] = [
    { instance: MAIN_AGENT, type: MAIN_AGENT, ...instanceStatsFromTranscript(main) },
    ...subs.map((s) => ({ instance: s.stem.replace(/^agent-/, ""), type: agentTypeFromMeta(s.meta), ...instanceStatsFromTranscript(s.text) })),
  ];
  // Hand-written on purpose: rows without a time use Infinity, and `a - b` gives NaN for
  // Infinity - Infinity, which would make the comparator inconsistent.
  const at = (r: InstanceRow) => r.startedAt ?? Infinity;
  return rows.sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1));
}

export async function reportForSession(dir: string, sessionId: string): Promise<AgentUsage[]> {
  const { main, subs } = await readSession(dir, sessionId);
  return aggregateByAgent([
    { agent: MAIN_AGENT, usage: usageFromTranscript(main) },
    ...subs.map((s) => ({ agent: agentTypeFromMeta(s.meta), usage: usageFromTranscript(s.text) })),
  ]);
}
