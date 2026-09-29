/**
 * The progress journal `implementer` keeps in a ticket's notes (ticket 0034): a fenced
 * `progress-journal` block recording where a run currently stands — step, worktree,
 * branch, base, last commit, checks, PR — so a session that dies mid-ticket (or a human
 * running `litecode resume`) can reconstruct state instead of replaying the whole thread.
 *
 * The ADR draft approval gate's `resume-manifest` (ADR 0008) is a special case of the same
 * journal, not a second format: this module reads both fenced-block shapes and normalizes
 * them into one `JournalEntry`, so callers never need to know which one a given ticket used.
 */

import { parseTokenCount } from "./tokens.ts";

export type JournalEntry = {
  /** Free-form step label, e.g. "step 4: implement" or "adr-pending-approval". */
  step: string;
  worktree?: string;
  branch?: string;
  base?: string;
  commit?: string;
  checks?: string;
  pr?: string;
  /** Tokens this run consumed (ticket 0062); summed across entries for the ticket total. */
  tokens?: number;
  /** Present only on resume-manifest-shaped entries (the ADR draft approval gate). */
  adrPath?: string;
  boardStatus?: string;
  adrPosted?: boolean;
};

// Up to 3 leading spaces, like CommonMark (and `fenceRegions` in src/tickets/spec.ts):
// implementer.md's own templates nest both fences inside a numbered-list item, indented 2-3
// spaces, so an agent that copies them verbatim writes an indented fence, not a column-0 one.
const OPEN_FENCE = /^ {0,3}```(progress-journal|resume-manifest)\s*$/;
const CLOSE_FENCE = /^ {0,3}```\s*$/;

/** Sha-like commit value, or the literal "none" the templates use before anything is committed. */
const COMMIT_RE = /^(none|[0-9a-f]{4,40})$/i;
/** A PR reference: a bare/`#`-prefixed number, or a URL — the two shapes `gh pr view` accepts. */
const PR_RE = /^(#?\d+|https?:\/\/\S+)$/;

export function isValidCommitValue(value: string): boolean {
  return COMMIT_RE.test(value.trim());
}

export function isValidPrValue(value: string): boolean {
  return PR_RE.test(value.trim());
}

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!/^[a-zA-Z_]+$/.test(key)) continue;
    fields.set(key, line.slice(colon + 1).trim());
  }
  return fields;
}

/**
 * `commit`/`pr` are kept as-is when they look valid (sha-like, "none", a bare/`#` number, or
 * a URL) and dropped otherwise — an unvalidated value from a ticket note must never reach
 * `git`/`gh`, which `resume.ts` calls with these fields directly (ticket 0049).
 */
/**
 * Normalizes "none" to a canonical lowercase so every `!== "none"` check downstream — in
 * `resume.ts` and anywhere else a `JournalEntry.commit` is read — can compare case-sensitively
 * without also having to know the value might have come in as "None"/"NONE".
 */
function validCommit(raw: string | undefined): string | undefined {
  if (raw === undefined || !isValidCommitValue(raw)) return undefined;
  return raw.trim().toLowerCase() === "none" ? "none" : raw.trim();
}

function validTokens(raw: string | undefined): number | undefined {
  return raw === undefined ? undefined : parseTokenCount(raw);
}

function validPr(raw: string | undefined): string | undefined {
  return raw !== undefined && isValidPrValue(raw) ? raw : undefined;
}

function fromResumeManifest(fields: Map<string, string>): JournalEntry {
  return {
    step: "adr-pending-approval",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    commit: validCommit(fields.get("commit")),
    adrPath: fields.get("adr_path"),
    boardStatus: fields.get("board_status"),
    checks: fields.get("checks_passed"),
    adrPosted: fields.get("adr_posted") === "true",
    tokens: validTokens(fields.get("tokens")),
  };
}

function fromProgressJournal(fields: Map<string, string>): JournalEntry {
  return {
    step: fields.get("step") ?? "unknown",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    base: fields.get("base"),
    commit: validCommit(fields.get("commit")),
    checks: fields.get("checks"),
    pr: validPr(fields.get("pr")),
    tokens: validTokens(fields.get("tokens")),
  };
}

/**
 * Every journal-shaped block found in a ticket body, in document order. Scans line-by-line
 * (like `fenceRegions` in `src/tickets/spec.ts`) rather than a single greedy regex, so CRLF
 * line endings parse the same as LF, and a fence a run forgot to close can't silently
 * swallow the next block as its own closing fence.
 */
export function parseJournalEntries(body: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  let openKind: "progress-journal" | "resume-manifest" | undefined;
  let buffer: string[] = [];

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    if (!openKind) {
      const m = OPEN_FENCE.exec(rawLine);
      if (m) {
        openKind = m[1] as "progress-journal" | "resume-manifest";
        buffer = [];
      }
      continue;
    }
    if (CLOSE_FENCE.test(rawLine)) {
      const fields = parseFields(buffer.join("\n"));
      entries.push(openKind === "resume-manifest" ? fromResumeManifest(fields) : fromProgressJournal(fields));
      openKind = undefined;
      continue;
    }
    if (OPEN_FENCE.test(rawLine)) {
      throw new Error(
        `unclosed \`\`\`${openKind}\`\`\` block in ticket notes — a new fenced block started before it was closed, which would otherwise get folded into it`,
      );
    }
    buffer.push(rawLine);
  }

  if (openKind) {
    throw new Error(
      `unclosed \`\`\`${openKind}\`\`\` block in ticket notes — add a closing \`\`\` fence instead of leaving it to run into whatever follows`,
    );
  }

  return entries;
}

/** The most recent journal entry in a ticket body — the one a resume reconstructs from. */
export function latestJournalEntry(body: string): JournalEntry | undefined {
  const entries = parseJournalEntries(body);
  return entries.length > 0 ? entries[entries.length - 1] : undefined;
}

/**
 * Renders a `progress-journal` fenced block for `implementer` to append as a ticket note.
 * Only fields that are set are printed, so a step before a PR exists doesn't print a blank
 * `pr:` line.
 */
export function formatJournalBlock(entry: {
  step: string;
  worktree?: string;
  branch?: string;
  base?: string;
  commit?: string;
  checks?: string;
  pr?: string;
  tokens?: number;
}): string {
  const lines = [
    `step: ${entry.step}`,
    entry.worktree ? `worktree: ${entry.worktree}` : undefined,
    entry.branch ? `branch: ${entry.branch}` : undefined,
    entry.base ? `base: ${entry.base}` : undefined,
    entry.commit ? `commit: ${entry.commit}` : undefined,
    entry.checks ? `checks: ${entry.checks}` : undefined,
    entry.pr ? `pr: ${entry.pr}` : undefined,
    entry.tokens !== undefined ? `tokens: ${entry.tokens}` : undefined,
  ].filter((l): l is string => l !== undefined);
  return "```progress-journal\n" + lines.join("\n") + "\n```";
}
