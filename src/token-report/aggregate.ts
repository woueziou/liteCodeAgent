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

/** Instance id and agent type of the main session transcript (sub-agents use their agentId / meta type). */
export const MAIN_AGENT = "main";

/** One model call: a message id counted once, in order of first appearance in the transcript. */
export interface UsageMessage {
  readonly usage: Usage;
  /** Epoch ms of the call: the timestamp of the first line carrying its id that has a usable one. */
  readonly at: number | undefined;
}

/**
 * The single reader of a transcript's usage lines, shared by the plain and the `--detail` report.
 * Skips blank and malformed lines and lines without usage, and drops synthetic API-error messages
 * (`message.model === "<synthetic>"` or `isApiErrorMessage: true`; zero usage, not a model call).
 * Lines without a message id are each their own call. A repeated id keeps the usage of its LAST
 * line (the streamed count only grows), at the position and time of its first line.
 */
export function usageMessages(text: string): UsageMessage[] {
  const byId = new Map<string, UsageMessage>();
  let anonymous = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const o = obj as { timestamp?: unknown; isApiErrorMessage?: unknown; message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> } } | null;
    const u = o?.message?.usage;
    if (!u || typeof u !== "object") continue;
    if (o?.isApiErrorMessage === true || o?.message?.model === "<synthetic>") continue;
    const id = typeof o?.message?.id === "string" ? o.message.id : `anon-${anonymous++}`;
    const parsed = typeof o?.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    byId.set(id, {
      usage: {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        cacheCreation: num(u.cache_creation_input_tokens),
      },
      at: byId.get(id)?.at ?? (Number.isFinite(parsed) ? parsed : undefined),
    });
  }
  return [...byId.values()];
}

/** Usage per unique message id in one transcript's text; malformed lines are skipped. */
export function usageFromTranscript(text: string): Usage {
  return usageMessages(text).reduce((sum, m) => addUsage(sum, m.usage), ZERO_USAGE);
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
  return [`session ${sessionId}`, renderTable(head, body, last, 1)].join("\n");
}

/** Aligned table: the first `leftCols` columns are left-aligned, the others right-aligned; `last` is the TOTAL row. */
function renderTable(head: string[], body: string[][], last: string[], leftCols: number): string {
  const all = [head, ...body, last];
  const widths = head.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const fmt = (r: string[]) => r.map((cell, i) => (i < leftCols ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join("  ").trimEnd();
  return all.map(fmt).join("\n");
}

/**
 * `--detail` (ticket 0080): one row per agent INSTANCE, i.e. one transcript = one run (the main
 * session, or one file under `<session>/subagents/`).
 *
 * The context size of a call is the input side of that assistant message's usage:
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Output tokens are not
 * part of it. Calls come from `usageMessages`: each message id counts once (last line wins) and
 * synthetic API-error messages are not calls, so the totals reconcile with the plain report
 * (detail TOTAL context read == plain TOTAL minus output).
 *
 * Time semantics: a call's time is the timestamp of the first line carrying its id (a later
 * duplicate's timestamp only if that first line has none). An instance's `startedAt` is the
 * earliest time over its calls, and `firstContext` is the context of that same earliest call, so
 * the two always describe the same call. Transcript order only decides when times tie or are
 * missing (a call without a time never beats one with a time). An instance with no timed call has
 * no `startedAt` and sorts last among the rows.
 *
 * Known limits: a resumed agent (same agentId continued) is one transcript, hence ONE merged row;
 * nested sub-agents carry no parent link, they are flat rows like the others.
 */
export interface InstanceStats {
  readonly calls: number;
  /** Context size of the call with the earliest time (transcript order on ties or missing times). */
  readonly firstContext: number;
  readonly maxContext: number;
  /** Sum of the context sizes of all calls: the total context read across the run. */
  readonly contextRead: number;
  /** Epoch ms of the earliest call, undefined when no call carries a usable timestamp. */
  readonly startedAt: number | undefined;
}

export interface InstanceRow extends InstanceStats {
  readonly instance: string;
  readonly type: string;
}

const contextOf = (u: Usage): number => u.input + u.cacheRead + u.cacheCreation;

export function instanceStatsFromTranscript(text: string): InstanceStats {
  const calls = usageMessages(text).map((m) => ({ context: contextOf(m.usage), at: m.at }));
  // strict `<` keeps the earlier transcript position on ties; an untimed call (Infinity) never wins
  const first = calls.reduce<(typeof calls)[number] | undefined>((best, c) => (best === undefined || (c.at ?? Infinity) < (best.at ?? Infinity) ? c : best), undefined);
  return {
    calls: calls.length,
    firstContext: first?.context ?? 0,
    maxContext: Math.max(0, ...calls.map((c) => c.context)),
    contextRead: calls.reduce((s, c) => s + c.context, 0),
    startedAt: first?.at,
  };
}

/** Table printed under the per-type one with `--detail`; rows are expected in first-call order. */
export function renderDetail(rows: readonly InstanceRow[]): string {
  const head = ["instance", "type", "calls", "first context", "max context", "context read"];
  const body = rows.map((r) => [r.instance, r.type, r.calls, r.firstContext, r.maxContext, r.contextRead].map(String));
  const last = ["TOTAL", "", rows.reduce((s, r) => s + r.calls, 0), "-", Math.max(0, ...rows.map((r) => r.maxContext)), rows.reduce((s, r) => s + r.contextRead, 0)].map(String);
  return renderTable(head, body, last, 2);
}
