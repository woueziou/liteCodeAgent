/**
 * The board shape the core pipeline depends on.
 *
 * Agents refer to statuses by *role* (`inProgress`, `readyToMerge`, ...), never by the
 * literal label, so a project is free to name them differently as long as every role
 * maps to something. `board init` provisions anything missing; `board doctor` checks
 * that the generated board.json still matches reality.
 *
 * Status/priority/size vocabulary (`STATUS_ROLES`, `StatusRole`, `PRIORITY_OPTIONS`,
 * `SIZE_OPTIONS`) lives in `../tickets/spec.ts` — it's ticket vocabulary the ticket schema
 * needs at compile time, not board shape, so it must not depend on this module.
 */

import { STATUS_ROLES, PRIORITY_OPTIONS, SIZE_OPTIONS, type StatusRole } from "../tickets/spec.ts";

export type FieldSpec =
  | { name: string; kind: "single-select"; options: readonly string[] }
  | { name: string; kind: "text" }
  | { name: string; kind: "date" };

export const FIELD_SPECS: FieldSpec[] = [
  { name: "Status", kind: "single-select", options: STATUS_ROLES.map((s) => s.label) },
  { name: "Priority", kind: "single-select", options: PRIORITY_OPTIONS },
  { name: "Size", kind: "single-select", options: SIZE_OPTIONS },
  { name: "Assigned Agent", kind: "text" },
  { name: "Due Date", kind: "date" },
];

export const REQUIRED_LABELS: { name: string; description: string; color: string }[] = [
  { name: "bug", description: "Something is broken", color: "d73a4a" },
  { name: "feature", description: "New capability", color: "0e8a16" },
  { name: "doc", description: "Documentation only", color: "0075ca" },
  { name: "chore", description: "Maintenance, tooling, deps", color: "cfd3d7" },
];

/** Shape of the generated .claude/data/board.json. */
export type BoardData = {
  $generatedBy: string;
  owner: string;
  number: number;
  url: string;
  projectId: string;
  repo: string;
  fields: Record<
    string,
    { id: string; kind: string; options?: Record<string, string> }
  >;
  statusRoles: Record<StatusRole, { label: string; optionId: string }>;
};
