/**
 * Aggregates the local ticket buffer (`listTicketsDetailed`, `src/tickets/store.ts`) and
 * the ADR directory (`listAdrsDetailed`, `src/decisions/store.ts`) into the plain-data
 * shape `render.ts` turns into HTML. Deliberately produces **current-state** snapshots
 * only — counts by status/priority/size/label/epic, plus the current ADR list — never a
 * time series. The ticket frontmatter keeps no transition history (no log of status
 * changes), so anything trend-shaped here would have to be invented.
 * See docs/decisions/0012 for the (future) transition-journal design that would make a
 * real trend possible; until that lands, this module has nothing to build one from. Used
 * by both `litecode dashboard --build` (a committed snapshot) and `--serve` (rebuilt on
 * every request) — see ADR 0017.
 */

import { relative, dirname } from "node:path";
import { listTicketsDetailed, type TicketLoadError } from "../tickets/store.ts";
import { listAdrsDetailed, type AdrSummary, type AdrLoadError } from "../decisions/store.ts";
import { listPendingAdrs, type PendingAdr } from "../decisions/pending.ts";
import { STATUS_ROLES, PRIORITIES, SIZES, type StatusRole, type Priority, type Size, type Ticket } from "../tickets/spec.ts";

import { parseJournalEntries } from "../report/journal.ts";
import { ticketTokens } from "../report/tokens.ts";

export type StatusCount = { role: StatusRole; label: string; count: number };
export type PriorityCount = { priority: Priority; count: number };
export type SizeCount = { size: Size; count: number };
export type LabelCount = { label: string; count: number };
export type EpicSummary = {
  epic: string;
  total: number;
  byStatus: Record<StatusRole, number>;
  blocked: number;
  /** Sum of the tokens recorded by its tickets' journals (ticket 0062); 0 when none is known. */
  tokens: number;
};

export type DashboardData = {
  generatedAt: string;
  total: number;
  byStatus: StatusCount[];
  byPriority: PriorityCount[];
  bySize: SizeCount[];
  byLabel: LabelCount[];
  epics: EpicSummary[];
  /** Tokens per ticket id, for the tickets whose journal recorded any (ticket 0062). */
  tokensByTicket: Record<string, number>;
  /** Tickets whose status is `blocked` — surfaced separately, never just a count buried in a table. */
  blockedTickets: Ticket[];
  /** Every parsed ticket, for the full per-ticket listing. */
  tickets: Ticket[];
  /** Tickets `ticket doctor` would also flag: malformed files that didn't parse. */
  loadErrors: TicketLoadError[];
  /** Every parsed ADR from `docs/decisions/`, newest first (ticket 0032's ADR screen). */
  adrs: AdrSummary[];
  /** Malformed or unreadable ADR files — surfaced the same way `loadErrors` is. */
  adrLoadErrors: AdrLoadError[];
  /**
   * ADR drafts sitting behind `implementer`'s draft approval gate (ticket 0047): a
   * `resume-manifest` note names an `adr_path` that doesn't exist under `docs/decisions/`
   * yet. Surfaced separately from `adrs` since they aren't committed ADRs — the dashboard's
   * ADR screen lists them as "awaiting approval" rather than mixing them into the real list.
   */
  pendingAdrs: PendingAdr[];
};

/** Where the dashboard reads ADRs from, relative to `root`. Not configurable (yet). */
export const ADRS_DIR = "docs/decisions";

/**
 * A ticket's epic is the first path segment below the tickets dir (e.g.
 * `docs/tickets/local-first-tickets/0028-....md` -> `local-first-tickets`). A ticket
 * still sitting flat directly in the tickets dir (pre-migration layout, see ticket 0024)
 * has no epic segment — grouped under the literal label `"(sans epic)"` rather than
 * dropped, so the flat/nested transition window doesn't silently lose tickets from the
 * per-epic breakdown.
 */
export function epicOf(ticket: Ticket, dir: string): string {
  const rel = relative(dir, ticket.path);
  const segments = dirname(rel).split("/").filter((s) => s !== "." && s !== "");
  return segments[0] ?? "(sans epic)";
}

/** `[epic, tokens]` pairs for the epics with any recorded tokens, sorted by epic name. */
export function tokensPerEpic(tickets: Ticket[], dir: string): [string, number][] {
  const totals = new Map<string, number>();
  for (const t of tickets) {
    const n = ticketTokens(t.body, parseJournalEntries);
    if (n !== undefined) totals.set(epicOf(t, dir), (totals.get(epicOf(t, dir)) ?? 0) + n);
  }
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function zeroByStatus(): Record<StatusRole, number> {
  const out = {} as Record<StatusRole, number>;
  for (const s of STATUS_ROLES) out[s.role] = 0;
  return out;
}

export async function buildDashboard(root: string, dir: string, now: Date = new Date()): Promise<DashboardData> {
  const { tickets, errors } = await listTicketsDetailed(root, dir);
  const { adrs, errors: adrLoadErrors } = await listAdrsDetailed(root, ADRS_DIR);
  const pendingAdrs = await listPendingAdrs(root, tickets);

  const byStatus = STATUS_ROLES.map((s) => ({
    role: s.role,
    label: s.label,
    count: tickets.filter((t) => t.status === s.role).length,
  }));
  const byPriority = PRIORITIES.map((p) => ({ priority: p, count: tickets.filter((t) => t.priority === p).length }));
  const bySize = SIZES.map((s) => ({ size: s, count: tickets.filter((t) => t.size === s).length }));

  const labelCounts = new Map<string, number>();
  for (const t of tickets) labelCounts.set(t.label, (labelCounts.get(t.label) ?? 0) + 1);
  const byLabel = [...labelCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  const tokensByTicket: Record<string, number> = {};
  for (const t of tickets) {
    const n = ticketTokens(t.body, parseJournalEntries);
    if (n !== undefined) tokensByTicket[t.id] = n;
  }

  const epicMap = new Map<string, EpicSummary>();
  for (const t of tickets) {
    const epic = epicOf(t, dir);
    const entry = epicMap.get(epic) ?? { epic, total: 0, byStatus: zeroByStatus(), blocked: 0, tokens: 0 };
    entry.tokens += tokensByTicket[t.id] ?? 0;
    entry.total += 1;
    entry.byStatus[t.status] += 1;
    if (t.status === "blocked") entry.blocked += 1;
    epicMap.set(epic, entry);
  }
  const epics = [...epicMap.values()].sort((a, b) => a.epic.localeCompare(b.epic));

  const blockedTickets = tickets.filter((t) => t.status === "blocked");

  return {
    generatedAt: now.toISOString(),
    total: tickets.length,
    byStatus,
    byPriority,
    bySize,
    byLabel,
    epics,
    tokensByTicket,
    blockedTickets,
    tickets,
    loadErrors: errors,
    adrs,
    adrLoadErrors,
    pendingAdrs,
  };
}
