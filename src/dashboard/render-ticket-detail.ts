/**
 * "LiteCodeAgent — Détail ticket" screen (design 2/4): in the Pencil design this is an
 * overlay opened from the queue. This server renders one self-contained HTML document with
 * no client-side routing, so the overlay is realized as a native `<details>` disclosure
 * per ticket, right where the ticket is listed in the queue — same interaction (click to
 * expand, no page navigation), no JS required. `renderTicketDetail` is the one place that
 * markup is built, so `render-queue.ts` and any other caller share the exact same shape.
 */

import type { Ticket } from "../tickets/spec.ts";
import { escapeHtml } from "./html.ts";
import { formatTokens } from "../report/tokens.ts";

export function renderTicketDetail(ticket: Ticket, tokens?: number): string {
  return `
    <details class="ticket-detail" id="ticket-${escapeHtml(ticket.id)}">
      <summary>
        <span class="badge badge-${escapeHtml(ticket.status)}">${escapeHtml(ticket.status)}</span>
        <span class="ticket-id">${escapeHtml(ticket.id)}</span>
        <span class="ticket-title">${escapeHtml(ticket.title)}</span>
        <span class="tag">${escapeHtml(ticket.priority)}/${escapeHtml(ticket.size)}</span>
        <span class="tag">${escapeHtml(ticket.assignedAgent)}</span>
      </summary>
      <div class="ticket-detail-body">
        <dl class="ticket-meta">
          <dt>Label</dt><dd>${escapeHtml(ticket.label)}</dd>
          <dt>Priorité</dt><dd>${escapeHtml(ticket.priority)}</dd>
          <dt>Taille</dt><dd>${escapeHtml(ticket.size)}</dd>
          <dt>Agent assigné</dt><dd>${escapeHtml(ticket.assignedAgent)}</dd>
          ${tokens === undefined ? "" : `<dt>Tokens</dt><dd>${formatTokens(tokens)}</dd>`}
          <dt>Chemin</dt><dd><code>${escapeHtml(ticket.path)}</code></dd>
        </dl>
        <pre class="ticket-body">${escapeHtml(ticket.body)}</pre>
      </div>
    </details>`;
}
