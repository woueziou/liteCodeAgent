/**
 * ADR drafts awaiting human approval (ticket 0047, ADR 0008's draft approval gate): the
 * gate deliberately holds the drafted ADR out of `docs/decisions/` until a human approves
 * it, recording an `adr_path` in a `resume-manifest` note on the ticket instead. Until that
 * commit lands, nothing else knows where to find the draft — this module detects that
 * window purely from the ticket buffer, reusing `parseJournalEntries` (`src/report/journal.ts`,
 * ticket 0034) rather than re-parsing the fenced block itself.
 */

import { basename, resolve } from "node:path";
import { parseJournal } from "../report/journal.ts";
import type { Ticket } from "../tickets/spec.ts";

export type PendingAdr = {
  ticketId: string;
  ticketPath: string;
  adrPath: string;
  /** The ADR's own leading 4-digit number, e.g. "0018" — derived from `adrPath`'s filename. */
  adrNumber: string;
  branch?: string;
  worktree?: string;
  /**
   * Full drafted ADR text, read from the ticket's dedicated `## ADR à valider : NNNN`
   * section (per `implementer`'s ADR gate, ticket 0047) — `null` if the ticket predates
   * that convention and only carries the manifest block, with no dedicated section to
   * read the draft text back out of.
   */
  text: string | null;
};

async function fileExists(abs: string): Promise<boolean> {
  return await Bun.file(abs).exists();
}

const ADR_NUMBER = /^(\d{4})-/;

function adrNumberFromPath(adrPath: string): string | undefined {
  return ADR_NUMBER.exec(basename(adrPath))?.[1];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The `resume-manifest` fence naming `adrPath` is always the trailing element of its note
 * (written right after the ADR draft text, per `implementer`'s ADR gate). Rather than
 * reuse `ticketSection` — which stops at *any* `##` heading, including the ADR's own
 * `## Context`/`## Decision` subheadings, truncating the draft — this finds the specific
 * fence naming `adrPath` and the `## ADR à valider : NNNN` heading immediately preceding
 * it, then returns everything between them: the full draft, subheadings included.
 */
function draftTextFor(rawBody: string, adrNumber: string, adrPath: string): string | null {
  // Normalize composed vs. decomposed accents (NFC vs. NFD "à") so a heading typed either
  // way still matches — bug-hunter found an NFD "à" otherwise silently produced `text: null`.
  const body = rawBody.normalize("NFC").replace(/\r\n?/g, "\n");
  const fenceRe = /```resume-manifest[^\S\n]*\n([\s\S]*?)```/g;
  // `adr_path:` may be indented (the gate's template shows the fence nested inside a
  // numbered list) — anchoring to column 0 missed that case, so allow leading whitespace.
  const adrPathLine = new RegExp(`^\\s*adr_path:\\s*${escapeRegExp(adrPath)}\\s*$`, "m");
  let fenceStart: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(body))) {
    if (adrPathLine.test(m[1]!)) fenceStart = m.index;
  }
  if (fenceStart === undefined) return null;

  // The whole heading lives on its own line: `[^\S\n]` (whitespace other than newline)
  // keeps every gap from crossing a line break, and `(?!\d)` ends the number without
  // requiring whitespace after it, so a glued suffix ("0018: X", "0018—X") still matches.
  const headingRe = new RegExp(`^##[^\\S\\n]+ADR à valider[^\\S\\n]*:[^\\S\\n]*${escapeRegExp(adrNumber)}(?!\\d).*$`, "gm");
  const before = body.slice(0, fenceStart);
  let headingEnd: number | undefined;
  let h: RegExpExecArray | null;
  while ((h = headingRe.exec(before))) {
    headingEnd = h.index + h[0].length;
  }
  if (headingEnd === undefined) return null;

  return body.slice(headingEnd, fenceStart).trim();
}

/**
 * One pending ADR per ticket: the ticket's *very latest* journal entry (of any shape),
 * provided it's still a `resume-manifest` carrying an `adr_path` whose file doesn't exist
 * under `root` yet. A ticket resumed through the gate more than once only contributes its
 * latest attempt — an earlier `adr_path` is superseded, not still pending. Once the human
 * approves and `implementer` resumes past the gate (step 6 onward, per the ADR gate's own
 * step 5), a fresh `progress-journal` note with no `adr_path` becomes the latest entry —
 * that must clear the pending state too, even before the ADR file itself lands on `main`
 * (it's committed on the ticket's own branch first, not immediately visible under `root`
 * here). Checking only "is there *some* resume-manifest with this adr_path" without regard
 * to what came after it would otherwise keep flagging an already-approved ADR as pending
 * for the entire in-progress/review/ready-to-merge window that follows.
 */
export async function listPendingAdrs(root: string, tickets: Ticket[]): Promise<PendingAdr[]> {
  const pending: PendingAdr[] = [];
  for (const t of tickets) {
    const { entries } = parseJournal(t.body);
    const latest = entries[entries.length - 1];
    if (!latest?.adrPath) continue;
    if (await fileExists(resolve(root, latest.adrPath))) continue;
    const adrNumber = adrNumberFromPath(latest.adrPath) ?? "????";
    pending.push({
      ticketId: t.id,
      ticketPath: t.path,
      adrPath: latest.adrPath,
      adrNumber,
      branch: latest.branch,
      worktree: latest.worktree,
      text: draftTextFor(t.body, adrNumber, latest.adrPath),
    });
  }
  return pending;
}
