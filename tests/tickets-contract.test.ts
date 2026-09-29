import { expect, test } from "bun:test";
import { CLARIFICATION_MARKER, hasPendingAdr, hasUnresolvedClarification, ticketSection } from "../src/tickets/spec.ts";

test("ticketSection extracts a section's content up to the next heading", () => {
  const body = [
    "## Contexte",
    "Why we're doing this.",
    "",
    "## Critères d'acceptation",
    "- one",
    "- two",
    "",
    "## Plan",
    "1. do it",
  ].join("\n");

  expect(ticketSection(body, "Contexte")).toBe("Why we're doing this.");
  expect(ticketSection(body, "Critères d'acceptation")).toBe("- one\n- two");
  expect(ticketSection(body, "Plan")).toBe("1. do it");
});

test("ticketSection returns null when the heading isn't present", () => {
  expect(ticketSection("## Contexte\nSome text.", "Hors périmètre")).toBeNull();
});

test("ticketSection returns an empty string for a heading with no content", () => {
  const body = "## Critères d'acceptation\n\n## Plan\nSomething.";
  expect(ticketSection(body, "Critères d'acceptation")).toBe("");
});

test("ticketSection matches case-insensitively and is not fooled by leading/trailing whitespace", () => {
  const body = "##   critères d'acceptation   \nDone when X.";
  expect(ticketSection(body, "Critères d'acceptation")).toBe("Done when X.");
});

test("ticketSection matches a heading written with a typographic apostrophe (U+2019)", () => {
  const body = "## Critères d’acceptation\nDone when X.";
  expect(ticketSection(body, "Critères d'acceptation")).toBe("Done when X.");
});

test("ticketSection matches a heading written in NFD (decomposed accents)", () => {
  const nfdHeading = "Critères d'acceptation".normalize("NFD");
  const body = `## ${nfdHeading}\nDone when X.`;
  expect(ticketSection(body, "Critères d'acceptation")).toBe("Done when X.");
});

test("ticketSection matches a heading with trailing whitespace", () => {
  const body = "## Critères d'acceptation   \nDone when X.";
  expect(ticketSection(body, "Critères d'acceptation")).toBe("Done when X.");
});

test("ticketSection does not let an empty ## line swallow the heading on the next line", () => {
  const body = "##\n## Critères d'acceptation\nX";
  expect(ticketSection(body, "Critères d'acceptation")).toBe("X");
});

test("hasUnresolvedClarification detects the marker anywhere in prose", () => {
  expect(hasUnresolvedClarification("## Plan\nDo the thing.")).toBe(false);
  expect(hasUnresolvedClarification(`## Contexte\n${CLARIFICATION_MARKER} which approach?`)).toBe(true);
});

test("hasUnresolvedClarification ignores the marker inside an inline code span or fenced block", () => {
  expect(hasUnresolvedClarification(`## Plan\nThe marker looks like \`${CLARIFICATION_MARKER}\` in prose.`)).toBe(false);
  expect(
    hasUnresolvedClarification(`## Plan\n\`\`\`\n${CLARIFICATION_MARKER} example from docs\n\`\`\`\n`),
  ).toBe(false);
});

test("hasPendingAdr detects an '## ADR à valider' heading, not one quoted in code or an approved one", () => {
  expect(hasPendingAdr("## Plan\nx")).toBe(false);
  expect(hasPendingAdr("## Plan\nx\n\n## ADR à valider : 0023\ndraft")).toBe(true);
  expect(hasPendingAdr("## ADR approuvé : 0023\ndraft")).toBe(false);
  expect(hasPendingAdr("```\n## ADR à valider : 0023\n```")).toBe(false);
  expect(hasPendingAdr("## ADR à valider :0023")).toBe(true);
});

test("hasPendingAdr is case/accent/NFD insensitive and ignores a mid-implementation draft holding a resume-manifest", () => {
  expect(hasPendingAdr("## ADR À valider : 0023\nx")).toBe(true);
  expect(hasPendingAdr("## ADR a valider : 0023\nx")).toBe(true);
  expect(hasPendingAdr("## ADR a\u0300 valider : 0023\nx")).toBe(true);
  const gate = "## ADR à valider : 0022\ndraft\n```resume-manifest\nadr_posted: true\n```\n";
  expect(hasPendingAdr(gate)).toBe(false);
  expect(hasPendingAdr(`${gate}\n## ADR à valider : 0023\nplain draft`)).toBe(true);
});

test("hasPendingAdr exempts a full mid-implementation draft with its own '## ' headings before the manifest", () => {
  const gate = "## ADR à valider : 0022\ndraft\n\n## Context\nc\n\n## Decisions\nd\n\n```resume-manifest\nadr_posted: true\n```\n";
  expect(hasPendingAdr(gate)).toBe(false);
  // a manifest merely quoted inside an outer fence does not exempt a planning-time draft
  expect(hasPendingAdr("## ADR à valider : 0023\n````\n```resume-manifest\nx\n```\n````\n")).toBe(true);
  expect(hasPendingAdr("## ADR\u00a0à valider : 0023\nx")).toBe(true);
});

test("hasPendingAdr: an '## ADR approuvé' heading ends a pending section (no \\b after the non-ASCII é)", () => {
  const body = [
    "## ADR à valider : 0099",
    "Draft, not approved yet.",
    "",
    "## ADR approuvé : 0098",
    "```resume-manifest",
    "worktree: ../worktrees/0098",
    "```",
    "",
  ].join("\n");
  expect(hasPendingAdr(body)).toBe(true);
});
