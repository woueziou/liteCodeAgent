/**
 * Renders a `DashboardData` (`build.ts`) into a single self-contained HTML document: CSS
 * inline, no external request, no CDN. Composes the four screens from
 * `docs/design/litecode-design.pen` (ticket 0032) — home, queue (+ ticket detail inline,
 * `render-queue.ts`/`render-ticket-detail.ts`), and ADRs (`render-adrs.ts`) — as anchored
 * sections in one document, navigable without client-side JS. Shared by both
 * `litecode dashboard --build` (a committed snapshot) and `--serve` (rebuilt on every
 * request, optionally filtered from the request's query string) — see ADR 0017.
 */

import type { DashboardData } from "./build.ts";
import type { QueueFilter } from "./filter.ts";
import type { StatusRole } from "../tickets/spec.ts";
import { escapeHtml } from "./html.ts";
import { tokensStylesheet } from "./tokens.ts";
import { renderHome } from "./render-home.ts";
import { renderQueue } from "./render-queue.ts";
import { renderAdrs } from "./render-adrs.ts";

export { escapeHtml, escapeAttr } from "./html.ts";

const STATUS_BG: Record<StatusRole, string> = {
  backlog: "#e2e8f0",
  planned: "#dbeafe",
  inProgress: "#fef3c7",
  blocked: "#fecaca",
  review: "#e9d5ff",
  readyToMerge: "#bbf7d0",
  done: "#d1fae5",
};

function statusBadge(role: StatusRole, label: string, count: number): string {
  return `<span class="badge badge-${role}">${escapeHtml(label)}: ${count}</span>`;
}

function renderStatusSection(data: DashboardData): string {
  const badges = data.byStatus.map((s) => statusBadge(s.role, s.label, s.count)).join(" ");
  const readyToMerge = data.byStatus.find((s) => s.role === "readyToMerge")?.count ?? 0;
  const done = data.byStatus.find((s) => s.role === "done")?.count ?? 0;
  return `
    <div class="card">
      <h3>Répartition par statut</h3>
      <div class="badges">${badges}</div>
      <p class="note">"Ready to Merge" (${readyToMerge}) ≠ "Done" (${done}) : le premier veut dire qu'il reste un clic humain, le second que c'est vraiment terminé.</p>
    </div>`;
}

function renderBlockedSection(data: DashboardData): string {
  if (data.blockedTickets.length === 0) {
    return `<div class="card"><h3>Tickets bloqués</h3><p class="note">Aucun ticket bloqué.</p></div>`;
  }
  const rows = data.blockedTickets
    .map(
      (t) =>
        `<li class="blocked-item"><strong>${escapeHtml(t.id)}</strong> — ${escapeHtml(t.title)} <span class="tag">${escapeHtml(t.priority)}/${escapeHtml(t.size)}</span></li>`,
    )
    .join("");
  return `
    <div class="card card-alert">
      <h3>⚠ Tickets bloqués (${data.blockedTickets.length})</h3>
      <ul class="blocked-list">${rows}</ul>
    </div>`;
}

function renderLoadErrors(data: DashboardData): string {
  if (data.loadErrors.length === 0) return "";
  const rows = data.loadErrors.map((e) => `<li>${escapeHtml(e.path)}: ${escapeHtml(e.error)}</li>`).join("");
  return `
    <div class="card card-alert">
      <h3>⚠ Fichiers en échec de lecture (${data.loadErrors.length})</h3>
      <ul>${rows}</ul>
    </div>`;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: var(--font-body); margin: 0; padding: 0; background: var(--bg2); color: var(--fg); }
  h1, h2, h3, .badge, .ticket-id, code, pre { font-family: var(--font-data); }
  header.top-nav { display: flex; align-items: center; gap: 1.5rem; padding: 1rem 2rem; background: var(--bg); border-bottom: 1px solid var(--border2); position: sticky; top: 0; }
  header.top-nav h1 { font-size: 1.1rem; margin: 0; flex: 1; }
  header.top-nav nav a { color: var(--fg); text-decoration: none; margin-left: 1rem; font-size: 0.9rem; }
  header.top-nav nav a:hover { color: var(--accent); }
  main { padding: 1.5rem 2rem; }
  .meta { color: var(--fg2); margin-bottom: 1.5rem; }
  .screen { margin-bottom: 2.5rem; }
  .screen-title { border-bottom: 2px solid var(--border); padding-bottom: 0.4rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .tiles { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .tile { background: var(--bg); border: 1px solid var(--border2); border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
  .tile-value { font-size: 2rem; font-weight: 700; }
  .tile-label { color: var(--fg2); font-size: 0.85rem; }
  .tile-alert { border-color: var(--block); background: var(--blockbg); }
  .card { background: var(--bg); border: 1px solid var(--border2); border-radius: 8px; padding: 1.25rem 1.5rem; }
  .card-alert { border-color: var(--block); background: var(--blockbg); }
  .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; border: 1px solid rgba(0,0,0,0.1); }
  .badge-backlog { background: #e2e8f0; color: #1e293b; }
  .badge-planned { background: #dbeafe; color: #1e3a8a; }
  .badge-inProgress { background: #fef3c7; color: #78350f; }
  .badge-blocked { background: var(--blockbg); color: var(--block); }
  .badge-review { background: #e9d5ff; color: #581c87; }
  .badge-readyToMerge { background: var(--readybg); color: var(--ready); }
  .badge-done { background: #d1fae5; color: #065f46; }
  .badge-adr { background: var(--humanbg); color: var(--human); }
  .note { color: var(--fg2); font-size: 0.9rem; }
  .cmd-hint { font-size: 0.85rem; }
  .queue-layout { display: grid; grid-template-columns: 200px 1fr; gap: 1.5rem; }
  .side-rail { list-style: none; margin: 0; padding: 0; background: var(--bg); border: 1px solid var(--border2); border-radius: 8px; }
  .side-rail li { display: flex; justify-content: space-between; padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--border2); font-size: 0.85rem; }
  .command-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
  .command-bar input, .command-bar select, .command-bar button { font-family: var(--font-body); padding: 0.4rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--fg); }
  .command-bar input[type=search] { flex: 1; min-width: 180px; }
  .active-filter { font-size: 0.85rem; color: var(--fg2); margin: 0 0 0.75rem; }
  .ticket-list details, .adr-list details { border-bottom: 1px solid var(--border2); padding: 0.4rem 0; }
  .ticket-list summary, .adr-list summary { cursor: pointer; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ticket-title, .adr-title { flex: 1; min-width: 200px; }
  .ticket-detail-body pre, .adr-body pre, .ticket-body { white-space: pre-wrap; word-break: break-word; background: var(--bg2); border: 1px solid var(--border2); border-radius: 6px; padding: 0.75rem; }
  .ticket-meta { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.75rem; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .tag { display: inline-block; font-size: 0.75rem; background: var(--bg2); border: 1px solid var(--border2); border-radius: 4px; padding: 0.05rem 0.4rem; margin-left: 0.4rem; }
  .blocked-item { padding: 0.4rem 0; border-bottom: 1px solid var(--blockbg); }
`;

/**
 * `filter` is only meaningful under `--serve` (read from the request's query string,
 * `filter.ts`); `--build` renders with no filter (everything shown) since a static file has
 * no request to read one from.
 */
export function renderDashboard(data: DashboardData, filter: QueueFilter = {}): string {
  return `<!--
  Both --build (this committed snapshot) and --serve (rebuilt on every request) share this
  renderer (ADR 0017). A --build snapshot goes stale the moment any ticket/ADR changes after
  it was generated — re-run \`litecode dashboard --build\` to refresh it, or use
  \`litecode dashboard --serve\` for a live view.
-->
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard tickets — litecodeagent</title>
<style>${tokensStylesheet()}${STYLE}</style>
</head>
<body>
  <header class="top-nav">
    <h1>Dashboard tickets — litecodeagent</h1>
    <nav>
      <a href="#accueil">Accueil</a>
      <a href="#file-dattente">File d'attente</a>
      <a href="#adrs">ADRs</a>
    </nav>
  </header>
  <main>
    <p class="meta">Généré le ${escapeHtml(data.generatedAt)} · état courant uniquement, aucune tendance temporelle (le frontmatter ne conserve pas l'historique des transitions — voir ADR 0012).</p>

    ${renderLoadErrors(data)}
    ${renderBlockedSection(data)}

    ${renderHome(data)}

    ${renderQueue(data, filter)}

    <div class="grid" style="margin-top:1.5rem">
      ${renderStatusSection(data)}
    </div>

    ${renderAdrs(data)}
  </main>
</body>
</html>
`;
}
