/**
 * Output-contract readers for the agents whose reports have no parser in `src/`
 * (reviewer, bug-hunter, orchestrator; ticket 0039). The implementer's report is read
 * by the real `parseReport` from `src/report/verify.ts` instead.
 *
 * Deliberately as tolerant as `parseReport`: a key may be wrapped in bold/backticks or
 * a list marker, and a value runs until the next known key, so a multi-line `FINDINGS:`
 * stays one field.
 */

export const REVIEWER_KEYS = ["VERDICT", "CHECK_OUTPUT", "ACCEPTANCE", "TEST_FIRST", "FINDINGS", "PLAN_FIDELITY", "REENTRY"] as const;
export const BUG_HUNTER_KEYS = ["HUNT", "CHECK_OUTPUT", "FINDINGS", "REENTRY"] as const;
export const ORCHESTRATOR_KEYS = ["SIZE", "PANEL", "BLOCKING_TENSION", "PLAN", "ADR", "ADR_DRAFT", "OPEN_QUESTIONS", "EPIC", "RECOMMENDATION"] as const;

const LINE = /^\s*(?:[-*>]\s+)?(?:\*\*|`)?([A-Z_]+):(?:\*\*|`)?\s?(.*)$/;

/** Fields by key; the first occurrence of a key wins, later lines of a value are joined. */
export function sentinelFields(text: string, keys: readonly string[]): Map<string, string> {
  const fields = new Map<string, string>();
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m && keys.includes(m[1]!)) {
      current = fields.has(m[1]!) ? undefined : m[1]!;
      if (current) fields.set(current, m[2]!.trim());
    } else if (current) {
      fields.set(current, `${fields.get(current)}\n${line}`.trim());
    }
  }
  return fields;
}

/** The keys of an agent prompt's `Output` block: the last fenced block that lists any. */
export function outputKeys(promptSource: string): string[] {
  const blocks = [...promptSource.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => [...m[1]!.matchAll(/^([A-Z_]+):/gm)].map((k) => k[1]!));
  return blocks.filter((keys) => keys.length > 0).at(-1) ?? [];
}

/** The leading enum word of a value: `partial. I executed nothing` is `partial`. */
export function enumWord(value: string | undefined, allowed: readonly string[]): string | undefined {
  const v = (value ?? "").replace(/^(\*\*|["'`])+/, "").trim().toLowerCase();
  return allowed.find((a) => new RegExp(`^${a}(?![a-z-])`).test(v));
}

/** The alternatives of a `KEY: <a|b|c ...>` line in a prompt's Output block. */
export function outputEnum(promptSource: string, key: string): string[] {
  const line = new RegExp(`^${key}: <(.*)>\\s*$`, "m").exec(promptSource)?.[1] ?? "";
  return line.split("|").map((alt) => /^\s*([a-z-]+)/.exec(alt)?.[1] ?? "").filter(Boolean);
}

export const VERDICTS = ["approve-with-notes", "approve", "changes-requested"] as const;
export const HUNTS = ["complete", "partial"] as const;
export const SIZES = ["trivial", "small", "medium", "large", "unknown"] as const;
export const PANELS = ["complete", "degraded"] as const;

export const parseReviewer = (t: string) => {
  const f = sentinelFields(t, REVIEWER_KEYS);
  return { fields: f, verdict: enumWord(f.get("VERDICT"), VERDICTS) };
};
export const parseBugHunter = (t: string) => {
  const f = sentinelFields(t, BUG_HUNTER_KEYS);
  return { fields: f, hunt: enumWord(f.get("HUNT"), HUNTS) };
};
export const parseOrchestrator = (t: string) => {
  const f = sentinelFields(t, ORCHESTRATOR_KEYS);
  return { fields: f, size: enumWord(f.get("SIZE"), SIZES), panel: enumWord(f.get("PANEL"), PANELS) };
};
