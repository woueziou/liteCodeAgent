/**
 * Renders a `DashboardData` (`build.ts`) into a single self-contained HTML string: CSS
 * and JS inline, no external request, no CDN, opens offline via double-click. All free-text
 * ticket content (titles, bodies) is user/agent-authored and must be escaped — it can
 * legitimately contain backticks, angle brackets, quotes, Markdown. `escapeHtml` below is
 * the one place that happens; every interpolation of ticket content in this file must go
 * through it (or `escapeAttr` for attribute contexts).
 */

import type { DashboardData } from "./build.ts";
import type { StatusRole } from "../tickets/spec.ts";

/** Escapes text for use inside an HTML element body. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes text for use inside a double-quoted HTML attribute. Same rule as element text. */
export function escapeAttr(input: string): string {
  return escapeHtml(input);
}

// Distinct per-status color + a short text badge, never color alone: every status chip
// carries its label text so the information isn't lost for anyone who can't distinguish
// the colors (accessibility constraint from the ticket).
const STATUS_STYLE: Record<StatusRole, { bg: string; fg: string }> = {
  backlog: { bg: "#e2e8f0", fg: "#1e293b" },
  planned: { bg: "#dbeafe", fg: "#1e3a8a" },
  inProgress: { bg: "#fef3c7", fg: "#78350f" },
  blocked: { bg: "#fecaca", fg: "#7f1d1d" },
  review: { bg: "#e9d5ff", fg: "#581c87" },
  readyToMerge: { bg: "#bbf7d0", fg: "#14532b" },
  done: { bg: "#d1fae5", fg: "#065f46" },
};

function statusBadge(role: StatusRole, label: string, count: number): string {
  const style = STATUS_STYLE[role];
  return `<span class="badge" style="background:${style.bg};color:${style.fg}">${escapeHtml(label)}: ${count}</span>`;
}

function statTile(label: string, value: number, extraClass = ""): string {
  return `<div class="tile ${extraClass}"><div class="tile-value">${value}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

function renderStatusSection(data: DashboardData): string {
  const badges = data.byStatus.map((s) => statusBadge(s.role, s.label, s.count)).join(" ");
  const readyToMerge = data.byStatus.find((s) => s.role === "readyToMerge")?.count ?? 0;
  const done = data.byStatus.find((s) => s.role === "done")?.count ?? 0;
  return `
    <section class="card">
      <h2>Répartition par statut</h2>
      <div class="badges">${badges}</div>
      <p class="note">"Ready to Merge" (${readyToMerge}) ≠ "Done" (${done}) : le premier veut dire qu'il reste un clic humain, le second que c'est vraiment terminé.</p>
    </section>`;
}

function renderAxisSection(title: string, rows: { label: string; count: number }[]): string {
  const items = rows
    .map((r) => `<li><span class="axis-label">${escapeHtml(r.label)}</span><span class="axis-count">${r.count}</span></li>`)
    .join("");
  return `
    <section class="card">
      <h2>${escapeHtml(title)}</h2>
      <ul class="axis-list">${items}</ul>
    </section>`;
}

function renderBlockedSection(data: DashboardData): string {
  if (data.blockedTickets.length === 0) {
    return `<section class="card"><h2>Tickets bloqués</h2><p class="note">Aucun ticket bloqué.</p></section>`;
  }
  const rows = data.blockedTickets
    .map(
      (t) =>
        `<li class="blocked-item"><strong>${escapeHtml(t.id)}</strong> — ${escapeHtml(t.title)} <span class="tag">${escapeHtml(t.priority)}/${escapeHtml(t.size)}</span></li>`,
    )
    .join("");
  return `
    <section class="card card-alert">
      <h2>⚠ Tickets bloqués (${data.blockedTickets.length})</h2>
      <ul class="blocked-list">${rows}</ul>
    </section>`;
}

function renderEpicSection(data: DashboardData): string {
  const rows = data.epics
    .map((e) => {
      const blockedTag = e.blocked > 0 ? ` <span class="tag tag-alert">${e.blocked} bloqué(s)</span>` : "";
      const doneCount = e.byStatus.done;
      const pct = e.total > 0 ? Math.round((doneCount / e.total) * 100) : 0;
      return `
        <li class="epic-row">
          <div class="epic-head"><strong>${escapeHtml(e.epic)}</strong> — ${e.total} ticket(s)${blockedTag}</div>
          <div class="epic-bar" role="img" aria-label="${escapeAttr(e.epic)}: ${doneCount}/${e.total} terminés">
            <div class="epic-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="epic-detail">${doneCount}/${e.total} terminés (${pct}%)</div>
        </li>`;
    })
    .join("");
  return `
    <section class="card">
      <h2>Découpage par epic</h2>
      <ul class="epic-list">${rows || '<li class="note">Aucun ticket.</li>'}</ul>
    </section>`;
}

/**
 * Every ticket, one collapsible row per ticket (`<details>`, no JS needed) so long titles
 * and long bodies don't force a wide table — this is the "how do we consult long bodies"
 * answer from the ticket: no external dependency, just native disclosure widgets.
 */
function renderTicketList(data: DashboardData): string {
  const items = data.tickets
    .map((t) => {
      const style = STATUS_STYLE[t.status];
      return `
        <details class="ticket">
          <summary>
            <span class="badge" style="background:${style.bg};color:${style.fg}">${escapeHtml(t.status)}</span>
            <span class="ticket-id">${escapeHtml(t.id)}</span>
            <span class="ticket-title">${escapeHtml(t.title)}</span>
            <span class="tag">${escapeHtml(t.priority)}/${escapeHtml(t.size)}</span>
          </summary>
          <div class="ticket-body"><pre>${escapeHtml(t.body)}</pre></div>
        </details>`;
    })
    .join("");
  return `
    <section class="card">
      <h2>Tous les tickets (${data.tickets.length})</h2>
      <div class="ticket-list">${items || '<p class="note">Aucun ticket.</p>'}</div>
    </section>`;
}

function renderLoadErrors(data: DashboardData): string {
  if (data.loadErrors.length === 0) return "";
  const rows = data.loadErrors.map((e) => `<li>${escapeHtml(e.path)}: ${escapeHtml(e.error)}</li>`).join("");
  return `
    <section class="card card-alert">
      <h2>⚠ Fichiers en échec de lecture (${data.loadErrors.length})</h2>
      <ul>${rows}</ul>
    </section>`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 2rem; background: #f8fafc; color: #0f172a; }
  h1 { margin-top: 0; }
  .meta { color: #475569; margin-bottom: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .tiles { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .tile { background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
  .tile-value { font-size: 2rem; font-weight: 700; }
  .tile-label { color: #475569; font-size: 0.85rem; }
  .tile-alert { border-color: #ef4444; background: #fef2f2; }
  .card { background: white; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1.25rem 1.5rem; }
  .card-alert { border-color: #ef4444; background: #fef2f2; }
  .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 999px; font-size: 0.85rem; font-weight: 600; border: 1px solid rgba(0,0,0,0.1); }
  .note { color: #475569; font-size: 0.9rem; }
  .axis-list, .epic-list, .blocked-list { list-style: none; margin: 0; padding: 0; }
  .axis-list li { display: flex; justify-content: space-between; padding: 0.35rem 0; border-bottom: 1px solid #e2e8f0; }
  .axis-count { font-weight: 700; }
  .epic-row { padding: 0.6rem 0; border-bottom: 1px solid #e2e8f0; }
  .epic-bar { background: #e2e8f0; border-radius: 4px; height: 8px; overflow: hidden; margin: 0.35rem 0; }
  .epic-bar-fill { background: #16a34a; height: 100%; }
  .epic-detail { font-size: 0.8rem; color: #475569; }
  .tag { display: inline-block; font-size: 0.75rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 0.05rem 0.4rem; margin-left: 0.4rem; }
  .tag-alert { background: #fecaca; border-color: #ef4444; color: #7f1d1d; }
  .blocked-item { padding: 0.4rem 0; border-bottom: 1px solid #fecaca; }
  .ticket-list details.ticket { border-bottom: 1px solid #e2e8f0; padding: 0.4rem 0; }
  .ticket-list summary { cursor: pointer; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .ticket-title { flex: 1; min-width: 200px; }
  .ticket-body pre { white-space: pre-wrap; word-break: break-word; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.75rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f172a; color: #e2e8f0; }
    .tile, .card { background: #1e293b; border-color: #334155; }
    .ticket-body pre { background: #0f172a; border-color: #334155; }
  }
`;

export function renderDashboard(data: DashboardData): string {
  const blocked = data.byStatus.find((s) => s.role === "blocked")?.count ?? 0;
  const tiles = [
    statTile("Tickets totaux", data.total),
    statTile("Bloqués", blocked, blocked > 0 ? "tile-alert" : ""),
    statTile("En cours", data.byStatus.find((s) => s.role === "inProgress")?.count ?? 0),
    statTile("Prêts à merger", data.byStatus.find((s) => s.role === "readyToMerge")?.count ?? 0),
  ].join("");

  return `<!--
  Committed snapshot (owner decision): this file is checked into git so it can be shared
  and browsed straight from GitHub, and its history tracked over time. It goes stale the
  moment any ticket's status/priority/size changes after this build — re-run
  \`litecode dashboard --build\` to refresh it before relying on it.
-->
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard tickets — litecodeagent</title>
<style>${STYLE}</style>
</head>
<body>
  <h1>Dashboard tickets — litecodeagent</h1>
  <p class="meta">Généré le ${escapeHtml(data.generatedAt)} · état courant uniquement, aucune tendance temporelle (le frontmatter ne conserve pas l'historique des transitions — voir ADR 0012).</p>

  <div class="tiles">${tiles}</div>

  ${renderLoadErrors(data)}
  ${renderBlockedSection(data)}

  <div class="grid">
    ${renderStatusSection(data)}
    ${renderAxisSection("Répartition par priorité", data.byPriority.map((p) => ({ label: p.priority, count: p.count })))}
    ${renderAxisSection("Répartition par taille", data.bySize.map((s) => ({ label: s.size, count: s.count })))}
    ${renderAxisSection("Répartition par label", data.byLabel.map((l) => ({ label: l.label, count: l.count })))}
  </div>

  <div class="grid" style="margin-top:1.5rem">
    ${renderEpicSection(data)}
  </div>

  <div style="margin-top:1.5rem">
    ${renderTicketList(data)}
  </div>
</body>
</html>
`;
}
