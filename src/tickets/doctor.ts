/**
 * Local diagnostic for the ticket buffer, the replacement for `litecode board doctor`
 * once the board goes away (see lot 6 of the local-first-tickets epic). Unlike the
 * board's doctor, this never calls GitHub — everything it checks lives on disk, so it
 * stays useful even after `src/board/` is deleted.
 *
 * The real motivation: a ticket file lost its opening `---` delimiter this week, hand-
 * edited via `Edit` instead of the CLI. Only `litecode ticket sync` caught it, by
 * refusing to proceed and naming the offending file. Once the board — and the drift it
 * exposed as a side effect of every `board doctor` run — is gone, nothing else plays
 * that role for the ticket buffer itself. This command is that role.
 */

import { relative } from "node:path";
import { listTicketsDetailed, type TicketLoadError } from "./store.ts";
import { TicketSchema, type Ticket } from "./spec.ts";

export type Finding = { severity: "error" | "warn"; message: string };

/**
 * A ticket file's path, relative to the tickets dir, must be either the flat form
 * (`NNNN-slug.md`) or one level nested under an epic directory (`<epic>/NNNN-slug.md`).
 * The migration to the nested-only form is a later lot (4), so both forms are valid
 * today — this only rejects a file that's neither (e.g. two levels deep, or whose
 * filename doesn't match its own `id`).
 */
function checkPlacement(ticket: Ticket, dir: string): Finding | null {
  const relPath = relative(dir, ticket.path);
  const segments = relPath.split("/");
  const filename = segments[segments.length - 1];
  const expectedFilename = `${ticket.id}.md`;

  if (segments.length > 2) {
    return {
      severity: "error",
      message: `${ticket.path}: nested more than one directory below ${dir} — expected '<id>.md' or '<epic>/<id>.md'`,
    };
  }
  if (filename !== expectedFilename) {
    return {
      severity: "error",
      message: `${ticket.path}: filename doesn't match its own id '${ticket.id}' (expected '${expectedFilename}')`,
    };
  }
  return null;
}

/**
 * `nextNumber` (src/tickets/store.ts) scans every ticket file recursively (lot 3) to
 * pick the next free NNNN, across every epic directory. Two ticket files sharing the
 * same leading number — created before that recursive scan existed, or by two writers
 * racing against stale listings — silently break that assumption: `nextNumber` would
 * keep colliding, and a human reading `docs/tickets/*` has no way to tell which of the
 * two is authoritative.
 */
function checkDuplicateNumbers(tickets: Ticket[]): Finding[] {
  const byNumber = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const number = t.id.slice(0, 4);
    const group = byNumber.get(number) ?? [];
    group.push(t);
    byNumber.set(number, group);
  }
  const findings: Finding[] = [];
  for (const [number, group] of byNumber) {
    if (group.length > 1) {
      findings.push({
        severity: "error",
        message: `duplicate ticket number '${number}' across ${group.map((t) => t.path).join(", ")}`,
      });
    }
  }
  return findings;
}

function reportLoadError(e: TicketLoadError): Finding {
  // `e.error` already carries the actionable, file-naming message produced by
  // `parseFrontmatter` (delimiter integrity) or `TicketSchema.safeParse` (frontmatter
  // shape) inside `parseTicket` — reuse it verbatim rather than re-deriving it.
  return { severity: "error", message: e.error };
}

/**
 * Sanity-checks a ticket file that DID parse against `TicketSchema` a second time, using
 * `safeParse` directly rather than the throwing `parseTicket` path, so a caller of
 * `doctor()` gets the same shape-validation vocabulary the ticket description calls for
 * without doctor needing its own bespoke schema errors. In practice this rarely finds
 * anything `listTicketsDetailed` didn't already catch (a ticket that made it into the
 * `tickets` array already passed this same schema) — it exists so the check is explicit
 * and named, not implicit in a shared helper, per the ticket's scope.
 */
function checkFrontmatterShape(ticket: Ticket): Finding[] {
  const parsed = TicketSchema.safeParse(ticket);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({
    severity: "error" as const,
    message: `${ticket.path}: ${i.path.join(".") || "(root)"}: ${i.message}`,
  }));
}

export async function doctor(root: string, dir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { tickets, errors } = await listTicketsDetailed(root, dir);

  for (const e of errors) findings.push(reportLoadError(e));
  for (const t of tickets) {
    findings.push(...checkFrontmatterShape(t));
    const placement = checkPlacement(t, dir);
    if (placement) findings.push(placement);
  }
  findings.push(...checkDuplicateNumbers(tickets));

  return findings;
}
