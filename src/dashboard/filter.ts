/**
 * Filtering for the queue screen's CommandBar (search + Type/Priorité/Agent filters,
 * ticket 0032). Pure function over `DashboardData.tickets` so both `--serve` (reads the
 * filter from the request's query string) and any future caller can reuse the exact same
 * logic without duplicating it in the renderer.
 */

import type { Ticket } from "../tickets/spec.ts";

export type QueueFilter = {
  q?: string;
  label?: string;
  priority?: string;
  assignedAgent?: string;
};

export function filterTickets(tickets: Ticket[], filter: QueueFilter): Ticket[] {
  const q = filter.q?.trim().toLowerCase();
  return tickets.filter((t) => {
    if (filter.label && t.label !== filter.label) return false;
    if (filter.priority && t.priority !== filter.priority) return false;
    if (filter.assignedAgent && t.assignedAgent !== filter.assignedAgent) return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.id.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Parses a `URLSearchParams` into a `QueueFilter`, dropping empty values. */
export function filterFromSearchParams(params: URLSearchParams): QueueFilter {
  const filter: QueueFilter = {};
  const q = params.get("q");
  const label = params.get("label");
  const priority = params.get("priority");
  const assignedAgent = params.get("assignedAgent");
  if (q) filter.q = q;
  if (label) filter.label = label;
  if (priority) filter.priority = priority;
  if (assignedAgent) filter.assignedAgent = assignedAgent;
  return filter;
}
