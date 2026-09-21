import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../config.ts";
import { graphql, gh } from "./gh.ts";
import {
  fetchProject,
  fetchItems,
  fetchOptionUsage,
  fetchSingleSelectValues,
  optionUsage,
  type RemoteProject,
  type RemoteField,
  type OptionUsage,
  type ItemFieldValues,
  DERIVED_DATATYPES,
} from "./query.ts";
import { FIELD_SPECS, REQUIRED_LABELS, type BoardData } from "./spec.ts";
import { STATUS_ROLES, type StatusRole } from "../tickets/spec.ts";

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

    if (DERIVED_DATATYPES.has(remote.dataType)) {
      blockers.push({
        field: spec.name,
        problem: `exists as a GitHub-derived field (${remote.dataType}), which cannot be edited via the API`,
        fix: `Field '${spec.name}' cannot be edited via the API — recreate it as a plain custom single-select in the Project UI`,
      });
      continue;
    }

    // A field can be SINGLE_SELECT-shaped (indistinguishable from a genuine custom field by
    // `dataType` alone) while still being derived from the issue itself — e.g. `Priority`
    // seeded from a repo's issue-forms template, with zero options. GitHub's own
    // `updateProjectV2Field` rejects mutating these the same way it rejects DERIVED_DATATYPES,
    // but the remedy differs: an issue-derived field's options live on the issue, not the
    // project, so they can't be fixed by editing the project field at all.
    if (remote.isIssueField === true) {
      blockers.push({
        field: spec.name,
        problem: `exists as an issue-derived field (${remote.dataType}), whose options live on the issue itself, not the project`,
        fix:
          `Field '${spec.name}' is derived from the issue/PR — its options can't be managed ` +
          `through the project API at all. Rename or remove this project-level field (or rename ` +
          `the spec field instead), then re-run.`,
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

  // No derived-field guard is needed here: this loop only ever fires for a field with no
  // name collision on the remote project (`!remote` in planBoard). A collision with a
  // GitHub-derived field is caught earlier, in planBoard, as a Blocker — which `applyBoardPlan`
  // already refuses to proceed past (see the check above). Every mutation this function
  // issues is driven off `plan.actions`, so as long as no caller builds actions by hand
  // instead of going through `planBoard`, this path can't reach a derived field.
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
        options,
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

  const planned = plan.actions.filter(
    (a) => a.kind === "add-options" || a.kind === "remove-options",
  );

  let before: ItemFieldValues = new Map();

  if (planned.length > 0) {
    /**
     * The option list is rebuilt from what the board holds RIGHT NOW, never from the
     * snapshot the plan was made against.
     *
     * The mutation sends the whole list, so any option absent from the list sent is
     * deleted — and an option added in the web UI between the plan and this moment is
     * absent from the stale snapshot. Rebuilding from it would delete that option and null
     * every item holding it, which is the exact destruction this code exists to avoid.
     * Re-planning against the fresh state also re-runs every blocker check, so an option
     * that became unknown, or newly in use, stops the run instead of being deleted.
     */
    const current = await fetchProject(config.project.board.owner, plan.project.number);
    before = await fetchSingleSelectValues(current.id);
    const currentPlan = planBoard(current, config, optionUsage(before));

    if (currentPlan.blockers.length > 0) {
      throw new Error(
        `The board changed since the plan was made, and the new state is blocked:\n` +
          currentPlan.blockers.map((b) => `  - ${b.field}: ${b.problem}`).join("\n") +
          `\nNothing was changed. Re-run to see the current plan.`,
      );
    }

    const actions = currentPlan.actions.filter(
      (a) => a.kind === "add-options" || a.kind === "remove-options",
    );
    // Add and remove are the same mutation — mergedOptions rebuilds the list from the
    // spec, appending what is missing and dropping what is not in it — so a field touched
    // by both is updated once, not twice.
    for (const field of [...new Set(actions.map((a) => a.field))]) {
      const spec = FIELD_SPECS.find((f) => f.name === field);
      if (!spec || spec.kind !== "single-select") continue;
      const remote = current.fields.find((f) => f.name === field);
      if (!remote) continue;
      try {
        await graphql(UPDATE_SELECT_FIELD, {
          fieldId: remote.id,
          options: mergedOptions(remote, spec.options),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Field '${field}': ${message}\n` +
            (log.length > 0
              ? `Fields already updated before failure: ${log.join("; ")}`
              : "No fields were updated before this failure."),
        );
      }
      for (const action of actions.filter((a) => a.field === field)) {
        const verb = action.kind === "add-options" ? "added" : "removed";
        log.push(`${verb} option(s) on '${field}': ${action.options.join(", ")}`);
      }
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
  /**
   * The catastrophic failure mode: an option-list update that regenerates every id and
   * strips the field from every item that pointed at an old one. Checked per item and per
   * field rather than by counting: a count cannot tell one item losing a value from
   * another gaining one, and it would only ever have watched Status, while the mutation
   * applies to every single-select the spec knows.
   */
  if (planned.length > 0) {
    const after = await fetchSingleSelectValues(refreshed.id);
    const lost: string[] = [];
    for (const [itemId, { issue, values }] of before) {
      const now = after.get(itemId);
      if (!now) continue; // item deleted meanwhile — not this run's doing
      for (const [field, option] of values) {
        if (now.values.get(field) === undefined) lost.push(`${field} on #${issue ?? itemId}`);
        else if (now.values.get(field) !== option) {
          lost.push(`${field} on #${issue ?? itemId} (${option} -> ${now.values.get(field)})`);
        }
      }
    }
    if (lost.length > 0) {
      throw new Error(
        `Field integrity check failed: ${lost.length} value(s) changed during this run:\n` +
          lost.map((l) => `  - ${l}`).join("\n") +
          `\nRestore them in the project UI before re-running. board.json was not written.`,
      );
    }
  }

  const nulled = (await fetchItems(refreshed.id)).filter((i) => i.status === null);
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
