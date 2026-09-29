/**
 * Token accounting per ticket (ticket 0062). Each `implementer` run records the tokens it
 * consumed in a `tokens:` field of its progress-journal note; a ticket's total is the sum
 * over every journal entry that carries one, so resumed runs add up instead of overwriting.
 */

import type { JournalEntry } from "./journal.ts";

/** A `TOKENS:`/`tokens:` value: a count, or the literal `unknown`. Anything else is no claim. */
export type TokensClaim = number | "unknown";

/**
 * Reads a count out of an agent-written value: `12345`, `12,345`, `12 345`, or one of those
 * followed by prose (`12345 (with sub-agents)`). Returns undefined for anything that doesn't
 * start with a count, so a malformed value is dropped rather than misread.
 */
export function parseTokenCount(value: string): number | undefined {
  const m = /^\s*(\d{1,3}(?:[ ,_]\d{3})+|\d+)(?![\d.,]*\d)/.exec(value.replace(/^(\*\*|["'`])+/, ""));
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/[ ,_]/g, ""));
  return Number.isSafeInteger(n) ? n : undefined;
}

export function parseTokensClaim(value: string | undefined): TokensClaim | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().replace(/^(\*\*|["'`])+|(\*\*|["'`])+$/g, "").trim();
  if (/^unknown\b/i.test(v)) return "unknown";
  return parseTokenCount(v);
}

/** Sum of every entry's `tokens`, or undefined when no entry recorded any. */
export function sumJournalTokens(entries: readonly JournalEntry[]): number | undefined {
  const counts = entries.map((e) => e.tokens).filter((t): t is number => t !== undefined);
  return counts.length === 0 ? undefined : counts.reduce((a, b) => a + b, 0);
}

/** `842`, `12.3k`, `1.20M`: compact display for list rows and dashboard tiles. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * A ticket's total from its body, tolerating a body with a malformed journal block (that
 * is `ticket doctor`/`resume`'s job to report, not a reason to break a listing).
 */
export function ticketTokens(body: string, parse: (body: string) => JournalEntry[]): number | undefined {
  try {
    return sumJournalTokens(parse(body));
  } catch {
    return undefined;
  }
}

/** Sum over tickets, counting only the ones whose total is known. */
export function sumKnown(totals: readonly (number | undefined)[]): number {
  return totals.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/**
 * The direct runner's own usage report supplies the count, so the agent never types it:
 * appends `TOKENS: <n>` to an implementer report that has none. Output without a `STATUS:`
 * line is not a report and is returned untouched.
 */
export function withTokensLine(output: string, usage: { input: number; output: number }): string {
  if (!/^\s*(?:[-*>]\s+)?(?:\*\*|`)?STATUS:/m.test(output)) return output;
  if (/^\s*(?:[-*>]\s+)?(?:\*\*|`)?TOKENS:/m.test(output)) return output;
  return `${output.replace(/\s+$/, "")}\nTOKENS: ${usage.input + usage.output}\n`;
}
