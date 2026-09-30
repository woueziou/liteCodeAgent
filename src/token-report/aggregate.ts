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
