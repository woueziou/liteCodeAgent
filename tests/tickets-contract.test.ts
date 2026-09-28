import { expect, test } from "bun:test";
import { CLARIFICATION_MARKER, hasUnresolvedClarification, ticketSection } from "../src/tickets/spec.ts";

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

test("hasUnresolvedClarification detects the marker anywhere in the body", () => {
  expect(hasUnresolvedClarification("## Plan\nDo the thing.")).toBe(false);
  expect(hasUnresolvedClarification(`## Contexte\n${CLARIFICATION_MARKER} which approach?`)).toBe(true);
});
