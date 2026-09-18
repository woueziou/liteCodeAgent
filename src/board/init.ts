import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../config.ts";
import { graphql, gh } from "./gh.ts";
import {
  fetchProject,
  fetchItems,
  fetchOptionUsage,
  type RemoteProject,
  type RemoteField,
  type OptionUsage,
} from "./query.ts";
import {
  FIELD_SPECS,
  STATUS_ROLES,
  REQUIRED_LABELS,
  type BoardData,
  type StatusRole,
} from "./spec.ts";

export type Action =
  | { kind: "create-field"; field: string; detail: string }
  | { kind: "add-options"; field: string; detail: string; options: string[] }
  | { kind: "remove-options"; field: string; detail: string; options: string[] }
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
 * Adding an option to an EXISTING single-select field used to be refused here, because
 * `updateProjectV2Field.singleSelectOptions` replaces the whole option list and the input
 * type carried no option `id` — every option was reassigned a fresh id, and every board
 * item whose Status referenced an old id silently became null. That destroyed a real
 * board once.
 *
 * GitHub has since added `id` to ProjectV2SingleSelectFieldOptionInput, so the existing
 * options can be echoed back with their own ids (and their own color/description, which
 * the same call would otherwise reset) while the new ones are appended without one. That
 * makes adding options non-destructive, and it is automated again — behind a before/after
 * check that every item still has a Status.
 *
 * REMOVING an option is decided by whether any item actually holds it. No id trick saves
 * an item whose option is deleted — but an option nothing holds has nothing to lose, and
 * that is the common case: GitHub's default `Todo` on a board the pipeline is only now
 * taking over. So removal is automated when usage is known to be zero, and stays a blocker
 * the moment a real item depends on it, where only a human can say where those items go.
 *
 * `usage` omitted means usage is unknown, which is treated as "in use" — the conservative
 * reading, since planning must never delete on an assumption.
 */
export function planBoard(
  project: RemoteProject,
  config: Config,
  usage?: OptionUsage,
): BoardPlan {
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
        actions.push({
          kind: "add-options",
          field: spec.name,
          detail: `add option(s): ${missing.join(", ")} (existing ids preserved)`,
          options: missing,
        });
      }
      const extra = [...have].filter((o) => !spec.options.includes(o));
      const perField = usage?.get(spec.name);
      const held = extra.filter((o) => !usage || (perField?.get(o) ?? 0) > 0);
      const unused = extra.filter((o) => !held.includes(o));

      if (unused.length > 0) {
        actions.push({
          kind: "remove-options",
          field: spec.name,
          detail: `remove unused option(s): ${unused.join(", ")} (no item holds them)`,
          options: unused,
        });
      }
      if (held.length > 0) {
        blockers.push({
          field: spec.name,
          problem: `has option(s) the pipeline does not know, still held by items: ${held
            .map((o) => `${o} (${perField?.get(o) ?? "?"} item(s))`)
            .join(", ")}`,
          fix:
            `move those items to a known option, then re-run — an unused option is removed ` +
            `automatically. Or extend FIELD_SPECS/statusRoles so agents know what the option ` +
            `means. Not automated while in use: deleting an option strips it from every item ` +
            `that holds it, and only a human can say where those items belong.`,
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

const UPDATE_SELECT_FIELD = `
mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2Field(input: {fieldId: $fieldId, singleSelectOptions: $options}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name } } }
  }
}`;

/**
 * The option list sent to `updateProjectV2Field` is the WHOLE list, not a delta: every
 * existing option must be echoed back with its own id, color and description, or it is
 * respectively re-created under a new id (nulling items), recoloured, or stripped of its
 * description. New options are the only ones sent without an id.
 */
export function mergedOptions(
  remote: RemoteField,
  specOptions: readonly string[],
): { id?: string; name: string; color: string; description: string }[] {
  const existing = new Map((remote.options ?? []).map((o) => [o.name, o]));
  return specOptions.map((name) => {
    const prior = existing.get(name);
    const description = STATUS_ROLES.find((r) => r.label === name)?.description ?? "";
    return {
      ...(prior ? { id: prior.id } : {}),
      name,
      color: prior?.color ?? "GRAY",
      description: prior?.description || description,
    };
  });
}

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

  // Add and remove are the same mutation — mergedOptions rebuilds the list from the spec,
  // which appends what is missing and drops what is not in it — so a field touched by both
  // is updated once, not twice.
  const optionActions = plan.actions.filter(
    (a) => a.kind === "add-options" || a.kind === "remove-options",
  );
  const touchedFields = [...new Set(optionActions.map((a) => a.field))];

  // Baseline taken BEFORE mutating, so a pre-existing null Status is not blamed on this
  // run — and so a null introduced by this run cannot hide behind one that predates it.
  const before = optionActions.length > 0 ? await fetchItems(plan.project.id) : [];
  const nullBefore = before.filter((i) => i.status === null).length;

  for (const field of touchedFields) {
    const spec = FIELD_SPECS.find((f) => f.name === field);
    if (!spec || spec.kind !== "single-select") continue;
    const remote = plan.project.fields.find((f) => f.name === field);
    if (!remote) continue;
    await graphql(UPDATE_SELECT_FIELD, {
      fieldId: remote.id,
      options: JSON.stringify(mergedOptions(remote, spec.options)),
    });
    for (const action of optionActions.filter((a) => a.field === field)) {
      const verb = action.kind === "add-options" ? "added" : "removed";
      log.push(`${verb} option(s) on '${field}': ${action.options.join(", ")}`);
    }
  }

  // Re-fetch so board.json carries the ids the server actually assigned, never guesses.
  const refreshed = await fetchProject(config.project.board.owner, plan.project.number);
  const verify = planBoard(refreshed, config, await fetchOptionUsage(refreshed.id));
  if (verify.blockers.length > 0) {
    throw new Error(
      `Post-apply verification failed:\n${verify.blockers.map((b) => `  - ${b.field}: ${b.problem}`).join("\n")}`,
    );
  }
  const unapplied = verify.actions.filter((a) => a.kind !== "write-board-json");
  if (unapplied.length > 0) {
    throw new Error(
      `Post-apply verification failed: still outstanding after applying:\n` +
        unapplied.map((a) => `  - ${a.field}: ${a.detail}`).join("\n"),
    );
  }

  // The failure mode this guards against: a field mutation silently nulling every item's
  // Status. Cheap to check, catastrophic to miss.
  const items = await fetchItems(refreshed.id);
  const nulled = items.filter((i) => i.status === null);

  // The catastrophic failure mode: an option-list update that regenerates every id and
  // nulls every item's Status. If this run made it worse, say so loudly rather than
  // writing a board.json that enshrines the damage.
  if (optionActions.length > 0 && nulled.length > nullBefore) {
    throw new Error(
      `Status integrity check failed: ${nulled.length - nullBefore} item(s) lost their Status ` +
        `during this run (issues: ${nulled.map((i) => i.issue ?? "?").join(", ")}).\n` +
        `Restore them in the project UI before re-running.`,
    );
  }
  if (nulled.length > 0) {
    log.push(
      `WARNING: ${nulled.length} board item(s) have a null Status ` +
        `(issues: ${nulled.map((i) => i.issue ?? "?").join(", ")}). This predates the run.`,
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
