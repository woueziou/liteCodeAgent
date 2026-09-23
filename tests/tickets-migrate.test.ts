import { expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, migrateTicket, type Ticket } from "../src/tickets/spec.ts";

function v1(body: string): Ticket {
  return {
    schemaVersion: 1,
    id: "0001-x",
    title: "x",
    label: "bug",
    status: "backlog",
    priority: "medium",
    size: "medium",
    assignedAgent: "human",
    dueDate: undefined,
    path: "docs/tickets/0001-x.md",
    body,
  };
}

const block = (text: string) => `<!-- litecode:comment -->\n${text}\n<!-- /litecode:comment -->\n`;

test("migration bumps the schema and unwraps a staged comment into plain text", () => {
  const out = migrateTicket(v1(`Body.\n\n${block("A comment.")}`));
  expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  expect(out.body).toBe("Body.\n\nA comment.\n");
});

test("back-to-back comments, or one glued to a paragraph, stay separate paragraphs", () => {
  expect(migrateTicket(v1(`Para\n${block("A")}${block("B")}`)).body).toBe("Para\n\nA\n\nB\n");
});

test("a comment block inside a code fence is an example and is left exactly as written", () => {
  const fenced = "```md\n" + block("keep me") + "\n\n\nstill here\n```\n";
  const out = migrateTicket(v1(`Example:\n\n${fenced}`)).body;
  expect(out).toContain(fenced.trimEnd());
});

test("an indented comment keeps its indentation, and migrating twice changes nothing", () => {
  const once = migrateTicket(v1(block("  indented line\n  second")));
  expect(once.body).toBe("  indented line\n  second\n");
  expect(migrateTicket(once).body).toBe(once.body);
});
