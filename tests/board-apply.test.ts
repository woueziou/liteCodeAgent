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
async function stubGh(): Promise<{ root: string; requests: () => Promise<Recorded[]> }> {
  const dir = await mkdtemp(join(tmpdir(), "litecode-apply-"));
  const log = join(dir, "requests.jsonl");
  const payload = JSON.stringify(complete());
  const bin = join(dir, "gh");

  await writeFile(
    bin,
    `#!/usr/bin/env bun
const fs = require("node:fs");
const args = process.argv.slice(2);
const project = ${payload};

if (args[0] !== "api" || args[1] !== "graphql") { process.exit(0); } // label create etc.

const body = JSON.parse(fs.readFileSync(0, "utf8"));
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(body) + "\\n");

const q = body.query;
let data;
if (q.includes("repositoryOwner")) {
  data = { repositoryOwner: { __typename: "User", projectV2: { ...project, fields: { nodes: project.fields } } } };
} else if (q.includes("fieldValues")) {
  data = { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
} else if (q.includes("items(")) {
  data = { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
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
  const { root, requests } = await stubGh();

  const missingOne = {
    ...complete(),
    fields: complete().fields.map((f) =>
      f.name === "Status" ? { ...f, options: f.options!.filter((o) => o.name !== "Review") } : f,
    ),
  };
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
