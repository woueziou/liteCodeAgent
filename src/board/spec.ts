/**
 * The board shape the core pipeline depends on.
 *
 * Agents refer to statuses by *role* (`inProgress`, `readyToMerge`, ...), never by the
 * literal label, so a project is free to name them differently as long as every role
 * maps to something. `board init` provisions anything missing; `board doctor` checks
 * that the generated board.json still matches reality.
 */

export type StatusRole =
  | "backlog"
  | "planned"
  | "inProgress"
  | "blocked"
  | "review"
  | "readyToMerge"
  | "done";

export const STATUS_ROLES: { role: StatusRole; label: string; description: string }[] = [
  { role: "backlog", label: "Backlog", description: "Tracked, not yet scheduled" },
  { role: "planned", label: "Planned", description: "Scheduled by dispatcher, ready for implementer" },
  { role: "inProgress", label: "In Progress", description: "Implementer is actively working it" },
  { role: "blocked", label: "Blocked", description: "Escalated to triage or waiting on a human" },
  { role: "review", label: "Review", description: "PR open, needs a human judgment call" },
  { role: "readyToMerge", label: "Ready to Merge", description: "Reviewer approved, nothing left but merge" },
  { role: "done", label: "Done", description: "Merged or closed as verified-no-change" },
];

export const PRIORITY_OPTIONS = ["Low", "Medium", "High"] as const;
export const SIZE_OPTIONS = ["Trivial", "Small", "Medium", "Large"] as const;

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
