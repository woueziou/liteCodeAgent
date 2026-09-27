/**
 * "LiteCodeAgent — Accueil" screen (design 3/4): the home page, a small set of headline
 * tiles giving an at-a-glance read of the queue before drilling into it.
 */

import type { DashboardData } from "./build.ts";
import { escapeHtml } from "./html.ts";

function tile(label: string, value: number, alert = false): string {
  return `<div class="tile${alert ? " tile-alert" : ""}"><div class="tile-value">${value}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
}

export function renderHome(data: DashboardData): string {
  const blocked = data.byStatus.find((s) => s.role === "blocked")?.count ?? 0;
  const inProgress = data.byStatus.find((s) => s.role === "inProgress")?.count ?? 0;
  const readyToMerge = data.byStatus.find((s) => s.role === "readyToMerge")?.count ?? 0;
  const done = data.byStatus.find((s) => s.role === "done")?.count ?? 0;

  const tiles = [
    tile("Tickets totaux", data.total),
    tile("Bloqués", blocked, blocked > 0),
    tile("En cours", inProgress),
    tile("Prêts à merger", readyToMerge),
    tile("Terminés", done),
    tile("ADRs", data.adrs.length),
  ].join("");

  return `
    <section id="accueil" class="screen">
      <h2 class="screen-title">Accueil</h2>
      <div class="tiles">${tiles}</div>
      <p class="note">"Ready to Merge" (${readyToMerge}) ≠ "Done" (${done}) : le premier veut dire qu'il reste un clic humain, le second que c'est vraiment terminé.</p>
      <p class="cmd-hint">Recherche et filtres : voir <a href="#file-dattente">File d'attente</a>.</p>
    </section>`;
}
