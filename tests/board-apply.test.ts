import { expect, test, afterEach } from "bun:test";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.ts";
import { planBoard, applyBoardPlan } from "../src/board/init.ts";
import { FIELD_SPECS, STATUS_ROLES } from "../src/board/spec.ts";
import type { RemoteProject } from "../src/board/query.ts";

const EXAMPLE = join(import.meta.dir, "..", "examples", "ts-employee-service.litecode.config.json");
const config = ConfigSchema.parse(await Bun.file(EXAMPLE).json());

const realBin = process.env.LITECODE_GH_BIN;
afterEach(() => {
  if (realBin) process.env.LITECODE_GH_BIN = realBin;
  else delete process.env.LITECODE_GH_BIN;
});

function complete(): RemoteProject {
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
        ? { options: spec.options.map((name, j) => ({ id: `O${i}${j}`, name, color: "GRAY", description: "" })) }
        : {}),
    })),
  };
}

type Recorded = { query: string; variables: Record<string, unknown> };

/**
 * A stub `gh` that records every GraphQL request body and answers a board that is already
 * fully provisioned. Recording the *body* is the point: the previous encoding sent every
 * variable as a string, which no pure-function test could have caught — only something
 * that looks at what actually goes over the wire.
 */
async function stubGh(
  opts: { initial?: RemoteProject; items?: unknown[]; failUpdateOnCall?: number } = {},
): Promise<{ root: string; requests: () => Promise<Recorded[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-apply-"));
  const log = join(dir, "requests.jsonl");
  const payload = JSON.stringify(complete());
  const initial = JSON.stringify(opts.initial ?? complete());
  const items = JSON.stringify(opts.items ?? []);
  const failUpdateOnCall = opts.failUpdateOnCall ?? 0;
  const bin = join(dir, "gh");

  await writeFile(
    bin,
    `#!/usr/bin/env bun
const fs = require("node:fs");
const args = process.argv.slice(2);
const project = ${payload};
const initial = ${initial};
const items = ${items};
const failUpdateOnCall = ${failUpdateOnCall};

if (args[0] !== "api" || args[1] !== "graphql") { process.exit(0); } // label create etc.

const body = JSON.parse(fs.readFileSync(0, "utf8"));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(body) + "\\n");

const q = body.query;

if (failUpdateOnCall > 0 && q.includes("updateProjectV2Field")) {
  const prior = fs.readFileSync(${JSON.stringify(log)}, "utf8").split("\\n").filter(Boolean);
  const updateCallNumber = prior.filter((l) => l.includes("updateProjectV2Field")).length;
  if (updateCallNumber === failUpdateOnCall) {
    process.stderr.write("gh: Only custom fields can be updated. Fields derived from issues or pull requests must be updated through their respective APIs.");
    process.exit(1);
  }
}

let data;
if (q.includes("repositoryOwner")) {
  // Before any mutation the board is still in its initial state; after one, provisioned.
  const prior = fs.readFileSync(${JSON.stringify(log)}, "utf8").split("\\n").filter(Boolean);
  const mutated = prior.some((l) => l.includes("createProjectV2Field") || l.includes("updateProjectV2Field"));
  const p = mutated ? project : initial;
  data = { repositoryOwner: { __typename: "User", projectV2: { ...p, fields: { nodes: p.fields } } } };
} else if (q.includes("fieldValues")) {
  data = { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } } };
} else if (q.includes("items(")) {
  data = { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
} else if (q.includes("updateProjectV2Field")) {
  data = { updateProjectV2Field: { projectV2Field: { id: "x", name: "x", options: [] } } };
} else {
  data = { ok: true };
}
process.stdout.write(JSON.stringify({ data }));
`,
  );
  await chmod(bin, 0o755);
  process.env.LITECODE_GH_BIN = bin;

  return {
    root: dir,
    requests: async () =>
      (await readFile(log, "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Recorded),
  };
}

test("mutation variables go over the wire as real JSON types, not strings", async () => {
  const { root, requests } = await stubGh();

  // A board with no Status field at all: forces createProjectV2Field with an option list,
  // which is the exact call that `-f` encoding made impossible.
  const bare = { ...complete(), fields: complete().fields.filter((f) => f.name !== "Status") };
  const plan = planBoard(bare, config, new Map());

  await applyBoardPlan(root, plan, config);

  const create = (await requests()).find((r) => r.query.includes("createProjectV2Field"))!;
  expect(create).toBeDefined();

  const options = create.variables.options;
  expect(Array.isArray(options)).toBe(true); // the regression: this used to be a string
  expect(typeof (options as unknown[])[0]).toBe("object");
  expect((options as { name: string }[])[0]!.name).toBe("Backlog");
  expect(typeof create.variables.projectId).toBe("string");
});

test("adding options resends the whole list with existing ids intact", async () => {
  const missingOne = {
    ...complete(),
    fields: complete().fields.map((f) =>
      f.name === "Status" ? { ...f, options: f.options!.filter((o) => o.name !== "Review") } : f,
    ),
  };
  const { root, requests } = await stubGh({ initial: missingOne });
  const plan = planBoard(missingOne, config, new Map());

  await applyBoardPlan(root, plan, config);

  const update = (await requests()).find((r) => r.query.includes("updateProjectV2Field"))!;
  expect(update).toBeDefined();

  const options = update.variables.options as { id?: string; name: string }[];
  // The whole list, not a delta — anything omitted here would be destroyed server-side.
  expect(options.map((o) => o.name)).toEqual(STATUS_ROLES.map((r) => r.label));
  // Every pre-existing option carries its id back; only the new one has none.
  for (const o of options) {
    if (o.name === "Review") expect(o.id).toBeUndefined();
    else expect(o.id).toBeTruthy();
  }
});

test("apply writes board.json with the ids the server reported", async () => {
  const { root, requests } = await stubGh();
  const plan = planBoard({ ...complete(), fields: complete().fields.filter((f) => f.name !== "Due Date") }, config, new Map());

  const log = await applyBoardPlan(root, plan, config);

  expect(log.some((l) => l.includes("wrote"))).toBe(true);
  const written = JSON.parse(await readFile(join(root, config.project.board.dataFile), "utf8"));
  expect(written.statusRoles.inProgress.optionId).toBe("O02");
  expect((await requests()).length).toBeGreaterThan(0);
});

test("a board that changed since the plan aborts instead of deleting", async () => {
  // The destructive race: the plan was made against a snapshot, and someone has since
  // added an option in the web UI and put an item on it. Rebuilding the option list from
  // the stale snapshot would delete that option and strip it from the item.
  const planned = {
    ...complete(),
    fields: complete().fields.map((f) =>
      f.name === "Status" ? { ...f, options: f.options!.filter((o) => o.name !== "Review") } : f,
    ),
  };
  const drifted = {
    ...complete(),
    fields: complete().fields.map((f) =>
      f.name === "Status"
        ? {
            ...f,
            options: [
              ...f.options!.filter((o) => o.name !== "Review"),
              { id: "SURPRISE", name: "Icebox", color: "GRAY", description: "" },
            ],
          }
        : f,
    ),
  };
  const heldByAnItem = [
    {
      id: "ITEM1",
      content: { number: 42 },
      fieldValues: { nodes: [{ name: "Icebox", field: { name: "Status" } }] },
    },
  ];

  const { root, requests } = await stubGh({ initial: drifted, items: heldByAnItem });
  const plan = planBoard(planned, config, new Map());

  const err = (await applyBoardPlan(root, plan, config).catch((e) => e)) as Error;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("changed since the plan was made");
  expect(err.message).toContain("Icebox");
  expect(err.message).toContain("Nothing was changed");

  // The point of aborting is that nothing was destroyed — no mutation may have been sent.
  const sent = await requests();
  expect(sent.some((r) => r.query.includes("updateProjectV2Field"))).toBe(false);
});

test("applyBoardPlan refuses to mutate a field that collides with a derived field", async () => {
  const derived = {
    ...complete(),
    fields: complete().fields.map((f) => (f.name === "Priority" ? { ...f, dataType: "ASSIGNEES" } : f)),
  };
  const { root, requests } = await stubGh({ initial: derived });
  const plan = planBoard(derived, config, new Map());

  expect(plan.blockers.some((b) => b.field === "Priority")).toBe(true);

  const err = (await applyBoardPlan(root, plan, config).catch((e) => e)) as Error;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("unresolved blockers");

  // No create/update mutation may have been issued at all — planBoard's blocker stopped
  // applyBoardPlan before it ever reached the network.
  const sent = await requests();
  expect(sent.some((r) => r.query.includes("updateProjectV2Field"))).toBe(false);
  expect(sent.some((r) => r.query.includes("createProjectV2Field"))).toBe(false);
});

test("a mid-loop option-update failure reports which field already succeeded", async () => {
  // Two single-select fields both need an option added, so the loop updates two fields.
  // The stub fails the SECOND updateProjectV2Field call, after the first has already
  // logged its success — the thrown error must carry that already-applied work forward.
  const missingTwo = {
    ...complete(),
    fields: complete().fields.map((f) => {
      if (f.name === "Status") return { ...f, options: f.options!.filter((o) => o.name !== "Review") };
      if (f.name === "Priority") return { ...f, options: f.options!.filter((o) => o.name !== "High") };
      return f;
    }),
  };
  const { root } = await stubGh({ initial: missingTwo, failUpdateOnCall: 2 });
  const plan = planBoard(missingTwo, config, new Map());

  const err = (await applyBoardPlan(root, plan, config).catch((e) => e)) as Error;

  expect(err).toBeInstanceOf(Error);
  expect(err.message).toMatch(/Field '(Status|Priority)':/);
  expect(err.message).toContain("Only custom fields can be updated");
  expect(err.message).toContain("already updated before failure");
  // The first field's success must be named, not just "something succeeded".
  expect(err.message).toMatch(/added option\(s\) on '(Status|Priority)'/);
});
