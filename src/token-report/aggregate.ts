/**
 * Pure parsing and aggregation of Claude Code transcript lines (ticket 0075). One transcript
 * line is one JSON object; an assistant line carries `message.id` and `message.usage`. A
 * message split into several content blocks is logged once per block with the same id, so
 * usage is counted once per id, keeping the last line seen (the streamed count only grows).
 */

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export interface AgentUsage extends Usage {
  readonly agent: string;
  readonly total: number;
}

export const ZERO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreation: a.cacheCreation + b.cacheCreation,
});

export const totalOf = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheCreation;

/** Usage per unique message id in one transcript's text; malformed lines are skipped. */
export function usageFromTranscript(text: string): Usage {
  const byId = new Map<string, Usage>();
  let anonymous = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = (obj as { message?: { id?: unknown; usage?: Record<string, unknown> } } | null)?.message;
    const u = msg?.usage;
    if (!u || typeof u !== "object") continue;
    const id = typeof msg?.id === "string" ? msg.id : `anon-${anonymous++}`;
    byId.set(id, {
      input: num(u.input_tokens),
      output: num(u.output_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      cacheCreation: num(u.cache_creation_input_tokens),
    });
  }
  return [...byId.values()].reduce(addUsage, ZERO_USAGE);
}

/** Merges usages by agent name, then sorts by total descending (ties: name ascending). */
export function aggregateByAgent(items: readonly { agent: string; usage: Usage }[]): AgentUsage[] {
  const merged = new Map<string, Usage>();
  for (const { agent, usage } of items) merged.set(agent, addUsage(merged.get(agent) ?? ZERO_USAGE, usage));
  return [...merged.entries()]
    .map(([agent, u]) => ({ agent, ...u, total: totalOf(u) }))
    .sort((a, b) => b.total - a.total || a.agent.localeCompare(b.agent));
}

/** Agent type from a subagent `.meta.json`; unreadable or typeless meta falls back to "subagent". */
export function agentTypeFromMeta(text: string | undefined): string {
  try {
    const t = (JSON.parse(text ?? "") as { agentType?: unknown }).agentType;
    return typeof t === "string" && t.trim() ? t.trim() : "subagent";
  } catch {
    return "subagent";
  }
}

export function renderReport(sessionId: string, rows: readonly AgentUsage[]): string {
  const head = ["agent", "input", "output", "cache read", "cache creation", "total"];
  const body = rows.map((r) => [r.agent, r.input, r.output, r.cacheRead, r.cacheCreation, r.total].map(String));
  const grand = rows.reduce<Usage>((a, r) => addUsage(a, r), ZERO_USAGE);
  const last = ["TOTAL", grand.input, grand.output, grand.cacheRead, grand.cacheCreation, totalOf(grand)].map(String);
  const all = [head, ...body, last];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const fmt = (r: string[]) => r.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join("  ");
  return [`session ${sessionId}`, fmt(head), ...body.map(fmt), fmt(last)].join("\n");
}

/**
 * `--detail` (ticket 0080): one row per agent INSTANCE, i.e. one transcript = one run (the main
 * session, or one file under `<session>/subagents/`).
 *
 * The context size of a call is the input side of that assistant message's usage:
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Output tokens are not
 * part of it. Each message id counts once (the last line seen for the id, as in
 * `usageFromTranscript`); a call's time is the timestamp of the first line carrying its id.
 */
export interface InstanceStats {
  readonly calls: number;
  /** Context size of the first call (by transcript order). */
  readonly firstContext: number;
  readonly maxContext: number;
  /** Sum of the context sizes of all calls: the total read across the run. */
  readonly sumContext: number;
  /** Epoch ms of the first call, undefined when no line carries a usable timestamp. */
  readonly startedAt: number | undefined;
}

export interface InstanceRow extends InstanceStats {
  readonly instance: string;
  readonly type: string;
}

export function instanceStatsFromTranscript(text: string): InstanceStats {
  const calls = new Map<string, { context: number; at: number | undefined }>();
  let anonymous = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const o = obj as { timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } } | null;
    const u = o?.message?.usage;
    if (!u || typeof u !== "object") continue;
    const id = typeof o?.message?.id === "string" ? o.message.id : `anon-${anonymous++}`;
    const parsed = typeof o?.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    const context = num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    calls.set(id, { context, at: calls.get(id)?.at ?? (Number.isFinite(parsed) ? parsed : undefined) });
  }
  const all = [...calls.values()];
  const times = all.flatMap((c) => (c.at === undefined ? [] : [c.at]));
  return {
    calls: all.length,
    firstContext: all[0]?.context ?? 0,
    maxContext: Math.max(0, ...all.map((c) => c.context)),
    sumContext: all.reduce((s, c) => s + c.context, 0),
    startedAt: times.length ? Math.min(...times) : undefined,
  };
}

/** Table printed under the per-type one with `--detail`; rows are expected in first-call order. */
export function renderDetail(rows: readonly InstanceRow[]): string {
  const head = ["instance", "type", "calls", "first context", "max context", "context read"];
  const body = rows.map((r) => [r.instance, r.type, r.calls, r.firstContext, r.maxContext, r.sumContext].map(String));
  const last = ["TOTAL", "", rows.reduce((s, r) => s + r.calls, 0), "-", Math.max(0, ...rows.map((r) => r.maxContext)), rows.reduce((s, r) => s + r.sumContext, 0)].map(String);
  const all = [head, ...body, last];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const fmt = (r: string[]) => r.map((cell, i) => (i <= 1 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join("  ").trimEnd();
  return [fmt(head), ...body.map(fmt), fmt(last)].join("\n");
}
