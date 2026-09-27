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
      <div class="adr-list">${items || '<p class="note">Aucune ADR.</p>'}</div>
    </section>`;
}
