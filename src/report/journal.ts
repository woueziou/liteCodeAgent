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
};

const BLOCK = /```(progress-journal|resume-manifest)\n([\s\S]*?)```/g;

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!/^[a-zA-Z_]+$/.test(key)) continue;
    fields.set(key, line.slice(colon + 1).trim());
  }
  return fields;
}

function fromResumeManifest(fields: Map<string, string>): JournalEntry {
  return {
    step: "adr-pending-approval",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    commit: fields.get("commit"),
    adrPath: fields.get("adr_path"),
    boardStatus: fields.get("board_status"),
    checks: fields.get("checks_passed"),
    adrPosted: fields.get("adr_posted") === "true",
  };
}

function fromProgressJournal(fields: Map<string, string>): JournalEntry {
  return {
    step: fields.get("step") ?? "unknown",
    worktree: fields.get("worktree"),
    branch: fields.get("branch"),
    base: fields.get("base"),
    commit: fields.get("commit"),
    checks: fields.get("checks"),
    pr: fields.get("pr"),
  };
}

/** Every journal-shaped block found in a ticket body, in document order. */
export function parseJournalEntries(body: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK.exec(body))) {
    const kind = m[1]!;
    const fields = parseFields(m[2]!);
    entries.push(kind === "resume-manifest" ? fromResumeManifest(fields) : fromProgressJournal(fields));
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
