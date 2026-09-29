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

export type JournalEntry = {
  /** Free-form step label, e.g. "step 4: implement" or "adr-pending-approval". */
  step: string;
  worktree?: string;
  branch?: string;
  base?: string;
  commit?: string;
  checks?: string;
  pr?: string;
  /** Present only on resume-manifest-shaped entries (the ADR draft approval gate). */
  adrPath?: string;
  boardStatus?: string;
  adrPosted?: boolean;
  /** `commit`/`pr` values that were present but malformed, and therefore dropped (never `undefined`-silent). */
  invalid?: { field: "commit" | "pr"; value: string }[];
};

// Up to 3 leading spaces, like CommonMark (and `fenceRegions` in src/tickets/spec.ts):
// implementer.md's own templates nest both fences inside a numbered-list item, indented 2-3
// spaces, so an agent that copies them verbatim writes an indented fence, not a column-0 one.
const OPEN_FENCE = /^ {0,3}```(progress-journal|resume-manifest)\s*$/;
// A closing fence may be indented any amount: an opener at 0-3 spaces closed by a more
// indented fence is one coherent block, not an "unclosed" one.
const CLOSE_FENCE = /^\s*```\s*$/;
// 4+ spaces or a tab: an indented code block in CommonMark, so it is never read as a journal block.
const INDENTED_OPEN_FENCE = /^(?: {4,}|\t)[ \t]*```(progress-journal|resume-manifest)\s*$/;

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

function validPr(raw: string | undefined): string | undefined {
  return raw !== undefined && isValidPrValue(raw) ? raw : undefined;
}

function invalidOf(fields: Map<string, string>, names: ("commit" | "pr")[]): JournalEntry["invalid"] {
  const bad: NonNullable<JournalEntry["invalid"]> = [];
  for (const field of names) {
    const raw = fields.get(field);
    if (raw === undefined) continue;
    const ok = field === "commit" ? isValidCommitValue(raw) : isValidPrValue(raw);
    if (!ok) bad.push({ field, value: raw });
  }
  return bad.length > 0 ? bad : undefined;
}

function fromResumeManifest(fields: Map<string, string>): JournalEntry {
  return {
    invalid: invalidOf(fields, ["commit"]),
    step: "adr-pending-approval",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    commit: validCommit(fields.get("commit")),
    adrPath: fields.get("adr_path"),
    boardStatus: fields.get("board_status"),
    checks: fields.get("checks_passed"),
    adrPosted: fields.get("adr_posted") === "true",
  };
}

function fromProgressJournal(fields: Map<string, string>): JournalEntry {
  return {
    invalid: invalidOf(fields, ["commit", "pr"]),
    step: fields.get("step") ?? "unknown",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    base: fields.get("base"),
    commit: validCommit(fields.get("commit")),
    checks: fields.get("checks"),
    pr: validPr(fields.get("pr")),
  };
}

export type ParsedJournal = {
  entries: JournalEntry[];
  /** Non-fatal problems: an older unclosed block that was skipped, an indented block that was ignored. */
  warnings: string[];
  /** Set when the *last* block in the body never closed — its state can't be trusted. */
  unclosedTrailing?: string;
};

/**
 * Every journal-shaped block found in a ticket body, in document order, plus what went
 * wrong along the way. Scans line-by-line (like `fenceRegions` in `src/tickets/spec.ts`)
 * rather than a single greedy regex, so CRLF parses like LF, and a fence a run forgot to
 * close can't silently swallow the next block as its own closing fence: an older unclosed
 * block is discarded with a warning so a newer valid one still counts.
 */
export function parseJournal(body: string): ParsedJournal {
  const entries: JournalEntry[] = [];
  const warnings: string[] = [];
  let openKind: "progress-journal" | "resume-manifest" | undefined;
  let openLine = 0;
  let buffer: string[] = [];

  const lines = body.split(/\r\n|\r|\n/);
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    if (!openKind) {
      const m = OPEN_FENCE.exec(rawLine);
      if (m) {
        openKind = m[1] as "progress-journal" | "resume-manifest";
        openLine = lineNo;
        buffer = [];
      } else {
        const ind = INDENTED_OPEN_FENCE.exec(rawLine);
        if (ind) {
          warnings.push(
            `line ${lineNo}: \`\`\`${ind[1]}\`\`\` block is indented 4+ spaces or with a tab, so it was ignored — indent fences at most 3 spaces`,
          );
        }
      }
      return;
    }
    if (CLOSE_FENCE.test(rawLine)) {
      const fields = parseFields(buffer.join("\n"));
      entries.push(openKind === "resume-manifest" ? fromResumeManifest(fields) : fromProgressJournal(fields));
      openKind = undefined;
      return;
    }
    const reopen = OPEN_FENCE.exec(rawLine);
    if (reopen) {
      warnings.push(`unclosed \`\`\`${openKind}\`\`\` block opened at line ${openLine} was skipped — a new fenced block started at line ${lineNo} before it was closed`);
      openKind = reopen[1] as "progress-journal" | "resume-manifest";
      openLine = lineNo;
      buffer = [];
      return;
    }
    buffer.push(rawLine);
  });

  const unclosedTrailing = openKind
    ? `unclosed \`\`\`${openKind}\`\`\` block opened at line ${openLine} in ticket notes — add a closing \`\`\` fence instead of leaving it to run into whatever follows`
    : undefined;
  return { entries, warnings, unclosedTrailing };
}

/** Like `parseJournal`, but throws when the last block never closed (an older one is just skipped). */
export function parseJournalEntries(body: string): JournalEntry[] {
  const { entries, unclosedTrailing } = parseJournal(body);
  if (unclosedTrailing) throw new Error(unclosedTrailing);
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
}): string {
  const lines = [
    `step: ${entry.step}`,
    entry.worktree ? `worktree: ${entry.worktree}` : undefined,
    entry.branch ? `branch: ${entry.branch}` : undefined,
    entry.base ? `base: ${entry.base}` : undefined,
    entry.commit ? `commit: ${entry.commit}` : undefined,
    entry.checks ? `checks: ${entry.checks}` : undefined,
    entry.pr ? `pr: ${entry.pr}` : undefined,
  ].filter((l): l is string => l !== undefined);
  return "```progress-journal\n" + lines.join("\n") + "\n```";
}
