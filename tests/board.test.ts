import { expect, test } from "bun:test";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { planBoard, buildBoardData } from "../src/board/init.ts";
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

test("a missing option on an existing select is a blocker, never an automated fix", () => {
  // Adding it via GraphQL would regenerate every option id and null out every item's Status.
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
  expect(plan.actions.some((a) => a.kind === "create-field")).toBe(false);
  const blocker = plan.blockers.find((b) => b.field === "Status")!;
  expect(blocker.problem).toContain("Ready to Merge");
  expect(blocker.fix).toContain("web UI");
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
