import { expect, test } from "bun:test";
import { formatJournalBlock, parseJournalEntries } from "../src/report/journal.ts";
import { formatTokens, parseTokenCount, parseTokensClaim, runnerJournalNote, sumJournalTokens, ticketTokens, withTokensLine } from "../src/report/tokens.ts";
import { parseReport, verifyReport, type Probes } from "../src/report/verify.ts";
import { renderTicketDetail } from "../src/dashboard/render-ticket-detail.ts";
import { renderHome } from "../src/dashboard/render-home.ts";
import { tokensPerEpic } from "../src/dashboard/build.ts";
import type { DashboardData } from "../src/dashboard/build.ts";
import type { Ticket } from "../src/tickets/spec.ts";

const block = (step: string, extra = "") => `\n\`\`\`progress-journal\nstep: ${step}\n${extra}\`\`\`\n`;

test("parseTokenCount accepts counts and rejects junk", () => {
  expect(parseTokenCount("12345")).toBe(12345);
  expect(parseTokenCount("12,345 (with sub-agents)")).toBe(12345);
  expect(parseTokenCount("12_345")).toBe(12345);
  expect(parseTokenCount("**900**")).toBe(900);
  expect(parseTokenCount("about 12")).toBeUndefined();
  expect(parseTokenCount("12.5k")).toBeUndefined();
  expect(parseTokenCount("1.5")).toBeUndefined();
  expect(parseTokenCount("45k tokens")).toBeUndefined();
  expect(parseTokenCount("800 300 from subagents")).toBeUndefined();
  expect(parseTokenCount("")).toBeUndefined();
});

test("parseTokensClaim: count, unknown, nothing", () => {
  expect(parseTokensClaim("`900`")).toBe(900);
  expect(parseTokensClaim("unknown")).toBe("unknown");
  expect(parseTokensClaim("lots")).toBeUndefined();
  expect(parseTokensClaim(undefined)).toBeUndefined();
});

const BASE = "STATUS: in-progress-blocked\nTICKET: 0062\nBRANCH: n/a\nPR: none\nBLOCKER: x\nCHECK_OUTPUT: n/a\n";

test("parseReport reads TOKENS", () => {
  for (const [line, want] of [["TOKENS: 42,000", 42000], ["TOKENS: unknown", "unknown"], ["TOKENS: garbage", undefined], ["", undefined]] as const) {
    const r = parseReport(BASE + line);
    if ("error" in r) throw new Error(r.error.message);
    expect(r.report.tokens).toBe(want);
  }
});

test("verifyReport gives the same findings with or without TOKENS", async () => {
  const probes: Probes = {
    branchExists: async () => false,
    prView: async () => ({ kind: "none" }) as never,
    prChecks: async () => ({ kind: "none" }) as never,
    dirtyFiles: async () => [],
    branchFiles: async () => [],
    ticketStatus: async () => "blocked",
    forcePushed: async () => ({ kind: "no" }),
  };
  const a = parseReport(BASE), b = parseReport(BASE + "TOKENS: 5\n"), c = parseReport(BASE + "TOKENS: junk\n");
  if ("error" in a || "error" in b || "error" in c) throw new Error("parse");
  const want = await verifyReport(a.report, probes);
  expect(await verifyReport(b.report, probes)).toEqual(want);
  expect(await verifyReport(c.report, probes)).toEqual(want);
});

test("journal entries carry tokens and resumed runs add up", () => {
  const body = block("run 1", "tokens: 1000\n") + block("mid") + block("run 2 (resume)", "tokens: 2,500\n");
  const entries = parseJournalEntries(body);
  expect(entries.map((e) => e.tokens)).toEqual([1000, undefined, 2500]);
  expect(sumJournalTokens(entries)).toBe(3500);
  expect(ticketTokens(body, parseJournalEntries)).toBe(3500);
});

test("no tokens recorded means unknown, not zero; bad blocks do not throw", () => {
  expect(ticketTokens(block("x"), parseJournalEntries)).toBeUndefined();
  expect(ticketTokens("```progress-journal\nstep: x\n", parseJournalEntries)).toBeUndefined();
  expect(parseJournalEntries(block("x", "tokens: many\n"))[0]!.tokens).toBeUndefined();
});

test("formatJournalBlock round-trips tokens", () => {
  expect(parseJournalEntries(formatJournalBlock({ step: "s", tokens: 77 }))[0]!.tokens).toBe(77);
});

test("the runner's note adds to the total without becoming the latest journal entry", () => {
  const note = runnerJournalNote("implementer", { input: 100, output: 50 }, "2026-09-29");
  const body = block("run", "tokens: 10\nworktree: w\n") + "\n" + note;
  expect(ticketTokens(body, parseJournalEntries)).toBe(160);
  expect(parseJournalEntries(body)).toHaveLength(1);
  expect(ticketTokens(note, parseJournalEntries)).toBe(150);
});

test("a resume-manifest's tokens count", () => {
  const md = "```resume-manifest\nworktree: w\nbranch: b\ncommit: none\nadr_path: a\nadr_posted: true\ntokens: 4000\n```";
  expect(ticketTokens(md, parseJournalEntries)).toBe(4000);
});

test("formatTokens", () => {
  expect([formatTokens(999), formatTokens(1000), formatTokens(12345), formatTokens(999_999), formatTokens(1_200_000)]).toEqual(["999", "1.0k", "12.3k", "1.00M", "1.20M"]);
});

test("withTokensLine appends the runner's usage only to a report lacking TOKENS", () => {
  const u = { input: 100, output: 50 };
  expect(withTokensLine("STATUS: x\nTICKET: 1\n", u)).toBe("STATUS: x\nTICKET: 1\nTOKENS: 150\n");
  expect(withTokensLine("STATUS: x\nTOKENS: unknown\n", u)).toBe("STATUS: x\nTOKENS: 150\n");
  expect(withTokensLine("STATUS: x\n", { input: 0, output: 0 })).toBe("STATUS: x\n");
  expect(withTokensLine("just prose", u)).toBe("just prose");
});

function ticket(path: string, body: string): Ticket {
  return {
    schemaVersion: 2, id: path.split("/").pop()!.replace(".md", ""), title: "t", label: "chore", status: "done",
    priority: "medium", size: "small", assignedAgent: "human", dueDate: undefined, path, body, extraFrontmatter: {},
  };
}

test("tokensPerEpic sums per epic, skipping tickets without tokens", () => {
  const ts = [
    ticket("docs/tickets/a/0001-x.md", block("r", "tokens: 10\n")),
    ticket("docs/tickets/a/0002-x.md", block("r", "tokens: 5\n")),
    ticket("docs/tickets/a/0003-x.md", "none"),
    ticket("docs/tickets/b/0004-x.md", "none"),
  ];
  expect(tokensPerEpic(ts, "docs/tickets")).toEqual([["a", 15]]);
});

test("ticket detail shows tokens only when known", () => {
  const t = ticket("docs/tickets/a/0001-x.md", "b");
  expect(renderTicketDetail(t, 12345)).toContain("<dt>Tokens</dt><dd>12.3k</dd>");
  expect(renderTicketDetail(t)).not.toContain("Tokens");
});

test("home shows total and per-epic tokens when known", () => {
  const data = {
    total: 0, byStatus: [], adrs: [], tokensByTicket: { a: 1000, b: 500 },
    epics: [{ epic: "e1", tokens: 1500 }, { epic: "e2", tokens: 0 }],
  } as unknown as DashboardData;
  const html = renderHome(data);
  expect(html).toContain("e1 : 1.5k");
  expect(html).not.toContain("e2 :");
  expect(renderHome({ ...data, tokensByTicket: {}, epics: [] })).not.toContain("Tokens consommés");
});
