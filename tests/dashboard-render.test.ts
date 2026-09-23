import { expect, test } from "bun:test";
import { escapeHtml, renderDashboard } from "../src/dashboard/render.ts";
import { buildDashboard } from "../src/dashboard/build.ts";
import type { DashboardData } from "../src/dashboard/build.ts";
import type { Ticket } from "../src/tickets/spec.ts";

function fixture(overrides: Partial<Ticket> = {}): Ticket {
  return {
    schemaVersion: 2,
    id: "0001-x",
    title: "Ticket 0001-x",
    label: "chore",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path: "docs/tickets/0001-x.md",
    body: "Body.\n",
    ...overrides,
  };
}

function emptyData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    generatedAt: "2026-09-21T00:00:00.000Z",
    total: 0,
    byStatus: [],
    byPriority: [],
    bySize: [],
    byLabel: [],
    epics: [],
    blockedTickets: [],
    tickets: [],
    loadErrors: [],
    ...overrides,
  };
}

test("escapeHtml neutralizes tags, quotes, and script-ish content", () => {
  const hostile = `<script>alert("xss")</script> & 'quoted' <img src=x onerror=alert(1)>`;
  const escaped = escapeHtml(hostile);
  expect(escaped).not.toContain("<script>");
  expect(escaped).not.toContain("<img");
  expect(escaped).toBe(
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;quoted&#39; &lt;img src=x onerror=alert(1)&gt;",
  );
});

test("hostile ticket title/body is escaped in the rendered HTML, never breaks out of its container", () => {
  const hostile = fixture({
    title: `</summary><script>alert(1)</script>`,
    body: "```js\n<img src=x onerror=alert(1)>\n```\nGuillemets \" et backticks ` et < > chevrons.",
  });
  const data = emptyData({ total: 1, tickets: [hostile] });
  const html = renderDashboard(data);

  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).not.toContain("<img src=x onerror=alert(1)>");
  // the escaped forms must still be present, proving the content wasn't silently dropped
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
});

test("rendered dashboard is a single self-contained document with no external network reference", () => {
  const data = emptyData();
  const html = renderDashboard(data);

  expect(html).toContain("<!doctype html>");
  expect(html).toMatch(/<style>[\s\S]*<\/style>/);
  expect(html).not.toMatch(/https?:\/\//i);
  expect(html).not.toContain("<script src=");
  expect(html).not.toContain("cdn.");
});

test("a blocked ticket is called out distinctly, not just counted", () => {
  const blocked = fixture({ id: "0002-blocked", status: "blocked", title: "Ticket bloqué" });
  const data = emptyData({ total: 1, blockedTickets: [blocked], tickets: [blocked] });
  const html = renderDashboard(data);

  expect(html).toContain("Tickets bloqués");
  expect(html).toContain("0002-blocked");
});

test("readyToMerge and done are rendered as visually distinct counts", () => {
  const data = emptyData({
    byStatus: [
      { role: "readyToMerge", label: "Ready to Merge", count: 3 },
      { role: "done", label: "Done", count: 5 },
    ],
  });
  const html = renderDashboard(data);
  expect(html).toContain("Ready to Merge: 3");
  expect(html).toContain("Done: 5");
});

test("end-to-end: buildDashboard output renders without throwing on an empty buffer", async () => {
  const data = await buildDashboard("/nonexistent-root-for-test", "docs/tickets-empty");
  const html = renderDashboard(data);
  expect(html).toContain("Dashboard tickets");
});
