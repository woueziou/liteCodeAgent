/** Filesystem side of `token-report` (ticket 0075): locate and read Claude Code transcripts. */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentTypeFromMeta, aggregateByAgent, instanceStatsFromTranscript, usageFromTranscript, type AgentUsage, type InstanceRow } from "./aggregate.ts";

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

/**
 * One row per instance: `main` (the session transcript) plus one per file in
 * `<session>/subagents/` (instance id = file stem minus the `agent-` prefix, i.e. the agentId).
 * Sorted by first call time; rows without a timestamp go last, ties keep main first then file name.
 */
export async function instancesForSession(dir: string, sessionId: string): Promise<InstanceRow[]> {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const main = await readOr(join(dir, `${sessionId}.jsonl`));
  if (main === undefined) throw new Error(`no transcript for session ${sessionId} in ${dir}`);
  const subDir = join(dir, sessionId, "subagents");
  const files = (await readdir(subDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl")).sort();
  const subs = await Promise.all(
    files.map(async (n) => ({
      instance: n.replace(/\.jsonl$/, "").replace(/^agent-/, ""),
      type: agentTypeFromMeta(await readOr(join(subDir, n.replace(/\.jsonl$/, ".meta.json")))),
      ...instanceStatsFromTranscript((await readOr(join(subDir, n))) ?? ""),
    })),
  );
  const rows: InstanceRow[] = [{ instance: "main", type: "main", ...instanceStatsFromTranscript(main) }, ...subs];
  const at = (r: InstanceRow) => r.startedAt ?? Infinity;
  return rows.sort((a, b) => (at(a) === at(b) ? 0 : at(a) < at(b) ? -1 : 1));
}

export async function reportForSession(dir: string, sessionId: string): Promise<AgentUsage[]> {
  if (!SESSION_ID.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`);
  const main = await readOr(join(dir, `${sessionId}.jsonl`));
  if (main === undefined) throw new Error(`no transcript for session ${sessionId} in ${dir}`);
  const subDir = join(dir, sessionId, "subagents");
  const files = (await readdir(subDir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl"));
  const subs = await Promise.all(
    files.map(async (n) => ({
      agent: agentTypeFromMeta(await readOr(join(subDir, n.replace(/\.jsonl$/, ".meta.json")))),
      usage: usageFromTranscript((await readOr(join(subDir, n))) ?? ""),
    })),
  );
  return aggregateByAgent([{ agent: "main", usage: usageFromTranscript(main) }, ...subs]);
}
