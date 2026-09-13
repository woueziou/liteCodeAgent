import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../config.ts";
import { graphql, gh } from "./gh.ts";
import { fetchProject, fetchItems, type RemoteProject } from "./query.ts";
import {
  FIELD_SPECS,
  STATUS_ROLES,
  REQUIRED_LABELS,
  type BoardData,
  type StatusRole,
} from "./spec.ts";

export type Action =
  | { kind: "create-field"; field: string; detail: string }
  | { kind: "create-label"; field: string; detail: string }
  | { kind: "write-board-json"; field: string; detail: string };

export type Blocker = { field: string; problem: string; fix: string };

export type BoardPlan = {
  project: RemoteProject;
  actions: Action[];
  blockers: Blocker[];
  data: BoardData | null;
};

const DATATYPE: Record<string, string> = {
  "single-select": "SINGLE_SELECT",
  text: "TEXT",
  date: "DATE",
};

/**
 * Why adding an option to an EXISTING single-select field is never automated here:
 *
 * `updateProjectV2Field.singleSelectOptions` takes a list of {name, color, description} —
 * there is no option `id` in the input type, so the API cannot be asked to preserve the
 * existing option ids. Every option is reassigned a fresh id, and every board item whose
 * Status referenced an old id silently becomes null. That has already destroyed a real
 * board once. So: missing options on an existing field are reported as a blocker for a
 * human to fix in the web UI (which adds options non-destructively), never mutated here.
 */
export function planBoard(project: RemoteProject, config: Config): BoardPlan {
  const actions: Action[] = [];
  const blockers: Blocker[] = [];
  const byName = new Map(project.fields.map((f) => [f.name, f]));

  for (const spec of FIELD_SPECS) {
    const remote = byName.get(spec.name);
    if (!remote) {
      actions.push({
        kind: "create-field",
        field: spec.name,
        detail:
          spec.kind === "single-select"
            ? `create SINGLE_SELECT with options: ${spec.options.join(", ")}`
            : `create ${DATATYPE[spec.kind]} field`,
      });
      continue;
    }

    if (remote.dataType !== DATATYPE[spec.kind]) {
      blockers.push({
        field: spec.name,
        problem: `exists as ${remote.dataType}, pipeline expects ${DATATYPE[spec.kind]}`,
        fix: `rename or delete the existing '${spec.name}' field in the project UI, then re-run`,
      });
      continue;
    }

    if (spec.kind === "single-select") {
      const have = new Set((remote.options ?? []).map((o) => o.name));
      const missing = spec.options.filter((o) => !have.has(o));
      if (missing.length > 0) {
        blockers.push({
          field: spec.name,
          problem: `missing option(s): ${missing.join(", ")}`,
          fix:
            `add them in the project web UI (Settings -> ${spec.name} -> New option). ` +
            `Not automated: the GraphQL update replaces the whole option list and regenerates ` +
            `every option id, which nulls the field on every existing board item.`,
        });
      }
      const extra = [...have].filter((o) => !spec.options.includes(o));
      if (extra.length > 0) {
        blockers.push({
          field: spec.name,
          problem: `has option(s) the pipeline does not know: ${extra.join(", ")}`,
          fix: `either remove them, or extend FIELD_SPECS/statusRoles so agents know what they mean`,
        });
      }
    }
  }

  const data = blockers.length === 0 && actions.length === 0 ? buildBoardData(project, config) : null;
  if (data) {
    actions.push({
      kind: "write-board-json",
      field: config.project.board.dataFile,
      detail: "all ids resolved",
    });
  }
  return { project, actions, blockers, data };
}

export function buildBoardData(project: RemoteProject, config: Config): BoardData {
  const fields: BoardData["fields"] = {};
  for (const spec of FIELD_SPECS) {
    const remote = project.fields.find((f) => f.name === spec.name);
    if (!remote) throw new Error(`internal: field '${spec.name}' missing while building board.json`);
    fields[spec.name] = {
      id: remote.id,
      kind: spec.kind,
      ...(remote.options
        ? { options: Object.fromEntries(remote.options.map((o) => [o.name, o.id])) }
        : {}),
    };
  }

  const statusOptions = fields.Status?.options ?? {};
  const statusRoles = Object.fromEntries(
    STATUS_ROLES.map((s) => {
      const optionId = statusOptions[s.label];
      if (!optionId) throw new Error(`internal: Status option '${s.label}' has no id`);
      return [s.role, { label: s.label, optionId }];
    }),
  ) as Record<StatusRole, { label: string; optionId: string }>;

  return {
    $generatedBy: "litecode board init — do not edit by hand",
    owner: config.project.board.owner,
    number: project.number,
    url: project.url,
    projectId: project.id,
    repo: config.project.repo,
    fields,
    statusRoles,
  };
}

const CREATE_FIELD = `
mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!) {
  createProjectV2Field(input: {projectId: $projectId, name: $name, dataType: $dataType}) {
    projectV2Field { ... on ProjectV2Field { id name } }
  }
}`;

const CREATE_SELECT_FIELD = `
mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  createProjectV2Field(input: {projectId: $projectId, name: $name, dataType: SINGLE_SELECT, singleSelectOptions: $options}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } }
  }
}`;

export async function applyBoardPlan(
  projectRoot: string,
  plan: BoardPlan,
  config: Config,
): Promise<string[]> {
  if (plan.blockers.length > 0) {
    throw new Error("Refusing to apply: unresolved blockers (see report above)");
  }
  const log: string[] = [];

  for (const action of plan.actions.filter((a) => a.kind === "create-field")) {
    const spec = FIELD_SPECS.find((f) => f.name === action.field);
    if (!spec) continue;
    if (spec.kind === "single-select") {
      const options = spec.options.map((name) => ({
        name,
        color: "GRAY",
        description: STATUS_ROLES.find((s) => s.label === name)?.description ?? "",
      }));
      await graphql(CREATE_SELECT_FIELD, {
        projectId: plan.project.id,
        name: spec.name,
        options: JSON.stringify(options),
      });
    } else {
      await graphql(CREATE_FIELD, {
        projectId: plan.project.id,
        name: spec.name,
        dataType: DATATYPE[spec.kind]!,
      });
    }
    log.push(`created field '${spec.name}'`);
  }

  // Re-fetch so board.json carries the ids the server actually assigned, never guesses.
  const refreshed = await fetchProject(config.project.board.owner, plan.project.number);
  const verify = planBoard(refreshed, config);
  if (verify.blockers.length > 0) {
    throw new Error(
      `Post-apply verification failed:\n${verify.blockers.map((b) => `  - ${b.field}: ${b.problem}`).join("\n")}`,
    );
  }

  // The failure mode this guards against: a field mutation silently nulling every item's
  // Status. Cheap to check, catastrophic to miss.
  const items = await fetchItems(refreshed.id);
  const nulled = items.filter((i) => i.status === null);
  if (nulled.length > 0) {
    log.push(
      `WARNING: ${nulled.length} board item(s) have a null Status ` +
        `(issues: ${nulled.map((i) => i.issue ?? "?").join(", ")}). Verify this predates the run.`,
    );
  }

  const data = buildBoardData(refreshed, config);
  const path = resolve(projectRoot, config.project.board.dataFile);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
  log.push(`wrote ${config.project.board.dataFile}`);

  for (const label of REQUIRED_LABELS) {
    try {
      await gh([
        "label", "create", label.name,
        "--repo", config.project.repo,
        "--description", label.description,
        "--color", label.color,
      ]);
      log.push(`created label '${label.name}'`);
    } catch {
      // Already exists — `gh label create` exits non-zero on duplicates, which is fine.
    }
  }

  return log;
}
