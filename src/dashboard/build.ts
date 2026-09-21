/**
 * Aggregates the local ticket buffer (`listTicketsDetailed`, `src/tickets/store.ts`) into
 * the plain-data shape `render.ts` turns into HTML. Deliberately produces **current-state**
 * snapshots only — counts by status/priority/size/label/epic — never a time series. The
 * ticket frontmatter keeps no transition history (only `syncedAt`, the last sync moment,
 * not a log of status changes), so anything trend-shaped here would have to be invented.
 * See docs/decisions/0012 for the (future) transition-journal design that would make a
 * real trend possible; until that lands, this module has nothing to build one from.
 */

import { relative, dirname } from "node:path";
import { listTicketsDetailed, type TicketLoadError } from "../tickets/store.ts";
import { STATUS_ROLES, PRIORITIES, SIZES, type StatusRole, type Priority, type Size, type Ticket } from "../tickets/spec.ts";

export type StatusCount = { role: StatusRole; label: string; count: number };
export type PriorityCount = { priority: Priority; count: number };
export type SizeCount = { size: Size; count: number };
export type LabelCount = { label: string; count: number };
export type EpicSummary = {
  epic: string;
  total: number;
  byStatus: Record<StatusRole, number>;
  blocked: number;
};

export type DashboardData = {
  generatedAt: string;
  total: number;
  byStatus: StatusCount[];
  byPriority: PriorityCount[];
  bySize: SizeCount[];
  byLabel: LabelCount[];
  epics: EpicSummary[];
  /** Tickets whose status is `blocked` — surfaced separately, never just a count buried in a table. */
  blockedTickets: Ticket[];
  /** Every parsed ticket, for the full per-ticket listing. */
  tickets: Ticket[];
  /** Tickets `ticket doctor` would also flag: malformed files that didn't parse. */
  loadErrors: TicketLoadError[];
};

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

function zeroByStatus(): Record<StatusRole, number> {
  const out = {} as Record<StatusRole, number>;
  for (const s of STATUS_ROLES) out[s.role] = 0;
  return out;
}

export async function buildDashboard(root: string, dir: string, now: Date = new Date()): Promise<DashboardData> {
  const { tickets, errors } = await listTicketsDetailed(root, dir);

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

  const epicMap = new Map<string, EpicSummary>();
  for (const t of tickets) {
    const epic = epicOf(t, dir);
    const entry = epicMap.get(epic) ?? { epic, total: 0, byStatus: zeroByStatus(), blocked: 0 };
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
    blockedTickets,
    tickets,
    loadErrors: errors,
  };
}
