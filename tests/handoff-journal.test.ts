import { expect, test } from "bun:test";
import { formatJournalBlock, latestJournalEntry } from "../src/report/journal.ts";
import { checkStaleCloserHandoff } from "../src/doctor.ts";
import type { Ticket } from "../src/tickets/spec.ts";

test("handoff and handoffAt are optional and absent by default", () => {
  const entry = latestJournalEntry("```progress-journal\nstep: x\n```\n")!;
  expect(entry.handoff).toBeUndefined();
  expect(entry.handoffAt).toBeUndefined();
});

test("the handoff marker and its ISO time are parsed", () => {
  const body = "```progress-journal\nstep: x\nhandoff: closer in flight\nhandoffAt: 2026-10-05T10:00:00Z\n```\n";
  const entry = latestJournalEntry(body)!;
  expect(entry.handoff).toBe("closer in flight");
  expect(entry.handoffAt).toBe("2026-10-05T10:00:00Z");
  expect(latestJournalEntry("```progress-journal\nstep: x\nhandoff: returned\n```\n")!.handoff).toBe("returned");
});

test("an unknown handoff value or a non-ISO time is dropped, never trusted", () => {
  const entry = latestJournalEntry("```progress-journal\nstep: x\nhandoff: closing soon\nhandoffAt: yesterday\n```\n")!;
  expect(entry.handoff).toBeUndefined();
  expect(entry.handoffAt).toBeUndefined();
});

test("formatJournalBlock writes the handoff fields only when set, and they round-trip", () => {
  expect(formatJournalBlock({ step: "x" })).not.toContain("handoff");
  const block = formatJournalBlock({ step: "x", handoff: "closer in flight", handoffAt: "2026-10-05T10:00:00Z" });
  expect(block).toContain("handoff: closer in flight\nhandoffAt: 2026-10-05T10:00:00Z");
  expect(latestJournalEntry(block)).toMatchObject({ handoff: "closer in flight", handoffAt: "2026-10-05T10:00:00Z" });
});

// --- doctor: stale in-flight marker (ADR 0027) ---

function ticketWith(id: string, journal: string): Ticket {
  return {
    schemaVersion: 2,
    id,
    title: id,
    label: "chore",
    status: "inProgress",
    priority: "medium",
    size: "small",
    assignedAgent: "human",
    dueDate: undefined,
    path: `docs/tickets/${id}.md`,
    body: `Body.\n\n\`\`\`progress-journal\nstep: closing\n${journal}\n\`\`\`\n`,
    extraFrontmatter: {},
  };
}

test("doctor: an in-flight marker over 2 hours old is a warning naming ticket and age; a fresh one or a returned one is not", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const stale = ticketWith("0050-stale", "handoff: closer in flight\nhandoffAt: 2026-10-05T09:30:00Z");
  const fresh = ticketWith("0051-fresh", "handoff: closer in flight\nhandoffAt: 2026-10-05T11:00:00Z");
  const done = ticketWith("0052-done", "handoff: returned\nhandoffAt: 2026-10-05T01:00:00Z");
  const findings = checkStaleCloserHandoff([stale, fresh, done], now);
  expect(findings).toHaveLength(1);
  expect(findings[0]!.severity).toBe("warn");
  expect(findings[0]!.message).toContain("0050-stale");
  expect(findings[0]!.message).toContain("2 h 30 min");
});
