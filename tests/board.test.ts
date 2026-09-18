import { expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { planBoard, buildBoardData, mergedOptions } from "../src/board/init.ts";
import { FIELD_SPECS, STATUS_ROLES } from "../src/board/spec.ts";
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

test("an unexpected extra option is reported rather than removed", () => {
  const p = project();
  const plan = planBoard(
    {
      ...p,
      fields: p.fields.map((f) =>
        f.name === "Priority" ? { ...f, options: [...f.options!, { id: "X", name: "Urgent" }] } : f,
      ),
    },
    config,
  );
  expect(plan.blockers.find((b) => b.field === "Priority")!.problem).toContain("Urgent");
});

test("a field of the wrong type is a blocker", () => {
  const p = project();
  const plan = planBoard(
    { ...p, fields: p.fields.map((f) => (f.name === "Due Date" ? { ...f, dataType: "TEXT" } : f)) },
    config,
  );
  expect(plan.blockers.find((b) => b.field === "Due Date")!.problem).toContain("TEXT");
});
