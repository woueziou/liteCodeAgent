/**
 * "LiteCodeAgent — File d'attente" screen (design 1/4): side rail (status counts), the
 * ticket list (each row a `render-ticket-detail.ts` disclosure), and a CommandBar with
 * search plus Type/Priorité/Agent filters. The CommandBar is a plain GET form — no
 * client-side JS — so it degrades to "show everything" on the committed `--build`
 * snapshot (a static file ignores its own query string) and actually filters under
 * `--serve`, which reads `location.search` server-side (`filter.ts`).
 */

import type { DashboardData } from "./build.ts";
import type { Ticket } from "../tickets/spec.ts";
import type { QueueFilter } from "./filter.ts";
import { filterTickets } from "./filter.ts";
import { renderTicketDetail } from "./render-ticket-detail.ts";
import { escapeAttr, escapeHtml } from "./html.ts";

function sideRail(data: DashboardData): string {
  const rows = data.byStatus
    .map((s) => `<li><span class="rail-label">${escapeHtml(s.label)}</span><span class="rail-count">${s.count}</span></li>`)
    .join("");
  return `<ul class="side-rail">${rows}</ul>`;
}

function option(value: string, label: string, selected: string | undefined): string {
  const isSelected = selected === value ? " selected" : "";
  return `<option value="${escapeAttr(value)}"${isSelected}>${escapeHtml(label)}</option>`;
}

function commandBar(tickets: Ticket[], filter: QueueFilter): string {
  const labels = [...new Set(tickets.map((t) => t.label))].sort();
  const priorities = [...new Set(tickets.map((t) => t.priority))].sort();
  const agents = [...new Set(tickets.map((t) => t.assignedAgent))].sort();

  return `
    <form class="command-bar" method="get" action="#file-dattente">
      <input type="search" name="q" placeholder="Rechercher un ticket…" value="${escapeAttr(filter.q ?? "")}" aria-label="Recherche">
      <select name="label" aria-label="Type">
        <option value="">Type (tous)</option>
        ${labels.map((l) => option(l, l, filter.label)).join("")}
      </select>
      <select name="priority" aria-label="Priorité">
        <option value="">Priorité (toutes)</option>
        ${priorities.map((p) => option(p, p, filter.priority)).join("")}
      </select>
      <select name="assignedAgent" aria-label="Agent">
        <option value="">Agent (tous)</option>
        ${agents.map((a) => option(a, a, filter.assignedAgent)).join("")}
      </select>
      <button type="submit">Filtrer</button>
    </form>`;
}

function activeFilterSummary(filter: QueueFilter, shown: number, total: number): string {
  const parts: string[] = [];
  if (filter.q) parts.push(`recherche: "${escapeHtml(filter.q)}"`);
  if (filter.label) parts.push(`type: ${escapeHtml(filter.label)}`);
  if (filter.priority) parts.push(`priorité: ${escapeHtml(filter.priority)}`);
  if (filter.assignedAgent) parts.push(`agent: ${escapeHtml(filter.assignedAgent)}`);
  const summary = parts.length > 0 ? `Filtre actif — ${parts.join(", ")}` : "Aucun filtre actif";
  return `<p class="active-filter">${summary} · ${shown}/${total} ticket(s)</p>`;
}

export function renderQueue(data: DashboardData, filter: QueueFilter = {}): string {
  const shown = filterTickets(data.tickets, filter);
  const rows = shown.map(renderTicketDetail).join("") || '<p class="note">Aucun ticket ne correspond au filtre.</p>';

  return `
    <section id="file-dattente" class="screen screen-queue">
      <h2 class="screen-title">File d'attente</h2>
      <div class="queue-layout">
        <aside>${sideRail(data)}</aside>
        <div class="queue-main">
          ${commandBar(data.tickets, filter)}
          ${activeFilterSummary(filter, shown.length, data.tickets.length)}
          <div class="ticket-list">${rows}</div>
        </div>
      </div>
    </section>`;
}
