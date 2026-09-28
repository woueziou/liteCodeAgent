/**
 * "LiteCodeAgent — ADRs" screen (design 4/4): a list and a detail view, read from
 * `docs/decisions/` via `listAdrsDetailed` (`src/decisions/store.ts`). Same disclosure
 * pattern as the ticket queue: list + detail in one document, no client routing.
 */

import type { DashboardData } from "./build.ts";
import { escapeHtml } from "./html.ts";

function renderAdrLoadErrors(data: DashboardData): string {
  if (data.adrLoadErrors.length === 0) return "";
  const rows = data.adrLoadErrors.map((e) => `<li>${escapeHtml(e.path)}: ${escapeHtml(e.error)}</li>`).join("");
  return `
    <div class="card card-alert">
      <h3>⚠ ADR(s) en échec de lecture (${data.adrLoadErrors.length})</h3>
      <ul>${rows}</ul>
    </div>`;
}

/**
 * ADR drafts sitting behind `implementer`'s draft approval gate (ticket 0047): not yet
 * committed under `docs/decisions/`, so `listAdrsDetailed` never sees them — this is the
 * one place a human can find and read a pending draft without knowing which ticket to open.
 */
function renderPendingAdrs(data: DashboardData): string {
  if (data.pendingAdrs.length === 0) return "";
  const items = data.pendingAdrs
    .map(
      (p) => `
      <details class="adr-detail adr-pending" id="adr-pending-${escapeHtml(p.ticketId)}-${escapeHtml(p.adrNumber)}">
        <summary>
          <span class="badge badge-adr-pending">${escapeHtml(p.adrNumber)}</span>
          <span class="adr-title">${escapeHtml(p.adrPath)}</span>
          <span class="tag">à valider</span>
          <span class="tag">${escapeHtml(p.ticketId)}</span>
        </summary>
        <div class="adr-body">
          <p class="note">Brouillon en attente d'approbation humaine — non commité. Ticket : ${escapeHtml(p.ticketPath)}</p>
          ${p.text !== null ? `<pre>${escapeHtml(p.text)}</pre>` : '<p class="note">Texte du brouillon introuvable (ticket antérieur à la section dédiée) — voir le ticket.</p>'}
        </div>
      </details>`,
    )
    .join("");

  return `
    <div class="card card-alert">
      <h3>⚠ ADR(s) en attente d'approbation (${data.pendingAdrs.length})</h3>
      <div class="adr-list">${items}</div>
    </div>`;
}

export function renderAdrs(data: DashboardData): string {
  const items = data.adrs
    .map(
      (a) => `
      <details class="adr-detail" id="adr-${escapeHtml(a.id)}">
        <summary>
          <span class="badge badge-adr">${escapeHtml(a.id)}</span>
          <span class="adr-title">${escapeHtml(a.title)}</span>
          <span class="tag">${escapeHtml(a.status)}</span>
          <span class="tag">${escapeHtml(a.date)}</span>
        </summary>
        <div class="adr-body"><pre>${escapeHtml(a.body)}</pre></div>
      </details>`,
    )
    .join("");

  return `
    <section id="adrs" class="screen">
      <h2 class="screen-title">ADRs</h2>
      ${renderAdrLoadErrors(data)}
      ${renderPendingAdrs(data)}
      <div class="adr-list">${items || '<p class="note">Aucune ADR.</p>'}</div>
    </section>`;
}
