import { expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { planBoard, buildBoardData, mergedOptions } from "../src/board/init.ts";
import { FIELD_SPECS } from "../src/board/spec.ts";
import { STATUS_ROLES } from "../src/tickets/spec.ts";
import type { RemoteProject } from "../src/board/query.ts";

const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());

function project(overrides: Partial<RemoteProject> = {}): RemoteProject {
  return {
    id: "PVT_test",
    number: 1,
    title: "Test",
    url: "https://example.invalid",
    fields: FIELD_SPECS.map((spec, i) => ({
      id: `F${i}`,
      name: spec.name,
      dataType: spec.kind === "single-select" ? "SINGLE_SELECT" : spec.kind === "text" ? "TEXT" : "DATE",
      ...(spec.kind === "single-select"
        ? { options: spec.options.map((name, j) => ({ id: `O${i}${j}`, name })) }
        : {}),
    })),
    ...overrides,
  };
}

test("a fully provisioned board plans only the board.json write", () => {
  const plan = planBoard(project(), config);
  expect(plan.blockers).toEqual([]);
  expect(plan.actions.map((a) => a.kind)).toEqual(["write-board-json"]);
  expect(plan.data!.statusRoles.inProgress.label).toBe("In Progress");
});

test("every status role resolves to a real option id", () => {
  const data = buildBoardData(project(), config);
  for (const { role } of STATUS_ROLES) expect(data.statusRoles[role].optionId).toBeTruthy();
});

test("a missing field is planned for creation", () => {
  const p = project();
  const plan = planBoard({ ...p, fields: p.fields.filter((f) => f.name !== "Due Date") }, config);
  expect(plan.actions.some((a) => a.kind === "create-field" && a.field === "Due Date")).toBe(true);
  expect(plan.data).toBeNull();
});

test("a missing option on an existing select is added, not blocked", () => {
  const p = project();
  const plan = planBoard(
    {
      ...p,
      fields: p.fields.map((f) =>
        f.name === "Status" ? { ...f, options: f.options!.filter((o) => o.name !== "Ready to Merge") } : f,
      ),
    },
    config,
  );
  expect(plan.blockers).toEqual([]);
  const action = plan.actions.find((a) => a.kind === "add-options")!;
  expect(action.field).toBe("Status");
  expect(action.options).toEqual(["Ready to Merge"]);
});

test("merging options echoes every existing id back, and sends new ones without one", () => {
  // This is the whole safety property: an option that keeps its id keeps the items
  // pointing at it. Regenerating ids is what nulled a real board's Status once.
  const remote = {
    id: "F0",
    name: "Status",
    dataType: "SINGLE_SELECT",
    options: [
      { id: "opt-todo", name: "Backlog", color: "BLUE", description: "hand-written" },
      { id: "opt-prog", name: "In Progress", color: "YELLOW", description: "" },
    ],
  };
  const merged = mergedOptions(remote, ["Backlog", "In Progress", "Ready to Merge"]);

  expect(merged.map((o) => o.name)).toEqual(["Backlog", "In Progress", "Ready to Merge"]);
  expect(merged[0]!.id).toBe("opt-todo");
  expect(merged[1]!.id).toBe("opt-prog");
  expect(merged[2]!.id).toBeUndefined();

  // Colour and description are resent as-is: the same call would otherwise reset them.
  expect(merged[0]!.color).toBe("BLUE");
  expect(merged[0]!.description).toBe("hand-written");
  // An existing option with no description falls back to the spec's, not to empty.
  expect(merged[1]!.description).toBe("Implementer is actively working it");
});

test("an extra option still held by items is reported rather than removed", () => {
  const p = project();
  const withExtra = {
    ...p,
    fields: p.fields.map((f) =>
      f.name === "Status"
        ? { ...f, options: [...f.options!, { id: "X", name: "Icebox" }] }
        : f,
    ),
  };
  const usage = new Map([["Status", new Map([["Icebox", 3]])]]);

  const plan = planBoard(withExtra, config, usage);
  expect(plan.actions.some((a) => a.kind === "remove-options")).toBe(false);
  const blocker = plan.blockers.find((b) => b.field === "Status")!;
  expect(blocker.problem).toContain("Icebox (3 item(s))");
});

test("an extra option no item holds is removed automatically", () => {
  const p = project();
  const withExtra = {
    ...p,
    fields: p.fields.map((f) =>
      f.name === "Status"
        ? { ...f, options: [...f.options!, { id: "X", name: "Todo" }] }
        : f,
    ),
  };

  const plan = planBoard(withExtra, config, new Map());
  expect(plan.blockers).toEqual([]);
  const action = plan.actions.find((a) => a.kind === "remove-options")!;
  expect(action.options).toEqual(["Todo"]);
});

test("unknown usage is treated as in-use, never as licence to delete", () => {
  const p = project();
  const withExtra = {
    ...p,
    fields: p.fields.map((f) =>
      f.name === "Status"
        ? { ...f, options: [...f.options!, { id: "X", name: "Todo" }] }
        : f,
    ),
  };

  const plan = planBoard(withExtra, config); // no usage passed
  expect(plan.actions.some((a) => a.kind === "remove-options")).toBe(false);
  expect(plan.blockers.some((b) => b.field === "Status")).toBe(true);
});

test("rebuilding from the spec drops an extra option while keeping known ids", () => {
  const merged = mergedOptions(
    {
      id: "F0",
      name: "Status",
      dataType: "SINGLE_SELECT",
      options: [
        { id: "keep", name: "Backlog", color: "BLUE", description: "" },
        { id: "drop", name: "Todo", color: "GREEN", description: "" },
      ],
    },
    ["Backlog", "Planned"],
  );
  expect(merged.map((o) => o.name)).toEqual(["Backlog", "Planned"]);
  expect(merged[0]!.id).toBe("keep");
  expect(merged[1]!.id).toBeUndefined();
});

test("a field of the wrong type is a blocker", () => {
  const p = project();
  const plan = planBoard(
    { ...p, fields: p.fields.map((f) => (f.name === "Due Date" ? { ...f, dataType: "TEXT" } : f)) },
    config,
  );
  expect(plan.blockers.find((b) => b.field === "Due Date")!.problem).toContain("TEXT");
});

test("a name collision with a GitHub-derived field is a blocker, not a mutation attempt", () => {
  const p = project();
  const plan = planBoard(
    { ...p, fields: p.fields.map((f) => (f.name === "Priority" ? { ...f, dataType: "ASSIGNEES" } : f)) },
    config,
  );
  const blocker = plan.blockers.find((b) => b.field === "Priority")!;
  expect(blocker).toBeDefined();
  expect(blocker.problem).toContain("ASSIGNEES");
  expect(blocker.fix).toContain("cannot be edited via the API");
  // No action of any kind is emitted for a derived-field collision.
  expect(plan.actions.some((a) => a.field === "Priority")).toBe(false);
});

test("a derived TITLE field collision is also blocked", () => {
  const p = project();
  const plan = planBoard(
    { ...p, fields: p.fields.map((f) => (f.name === "Status" ? { ...f, dataType: "TITLE" } : f)) },
    config,
  );
  const blocker = plan.blockers.find((b) => b.field === "Status")!;
  expect(blocker).toBeDefined();
  expect(blocker.problem).toContain("TITLE");
});

test("an issue-derived SINGLE_SELECT field (Priority, isIssueField: true, no options) is a blocker, not a mutation attempt", () => {
  // Reproduces the actual reported bug: GitHub's `Priority` field is SINGLE_SELECT-shaped
  // and has zero options, identical by dataType to a genuine custom field. Only
  // `isIssueField` distinguishes it.
  const p = project();
  const plan = planBoard(
    {
      ...p,
      fields: p.fields.map((f) =>
        f.name === "Priority" ? { ...f, dataType: "SINGLE_SELECT", isIssueField: true, options: [] } : f,
      ),
    },
    config,
  );
  const blocker = plan.blockers.find((b) => b.field === "Priority")!;
  expect(blocker).toBeDefined();
  expect(blocker.fix).toContain("issue/PR");
  expect(plan.actions.some((a) => a.field === "Priority")).toBe(false);
});

test("a genuinely editable single-select field (isIssueField: false) with stale options is still planned normally", () => {
  // Companion to the Priority case above: confirms the isIssueField guard does not
  // over-block a field that is actually editable, even when its dataType and staleness
  // otherwise look identical to the Priority scenario.
  const p = project();
  const plan = planBoard(
    {
      ...p,
      fields: p.fields.map((f) =>
        f.name === "Size"
          ? {
              ...f,
              isIssueField: false,
              options: ["XS", "S", "M", "L", "XL"].map((name, i) => ({ id: `SZ${i}`, name })),
            }
          : f,
      ),
    },
    config,
    new Map(), // no items hold the stale options, so they're safe to remove automatically
  );
  expect(plan.blockers.some((b) => b.field === "Size")).toBe(false);
  const sizeActions = plan.actions.filter((a) => a.field === "Size");
  expect(sizeActions.length).toBeGreaterThan(0);
  expect(sizeActions.some((a) => a.kind === "add-options" || a.kind === "remove-options")).toBe(true);
});
