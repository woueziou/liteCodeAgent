import type { InstallPlan } from "./install.ts";

export type StaleFinding = { severity: "warn"; message: string };

/**
 * Managed files whose rendered content no longer matches what is on disk although nobody
 * edited them (`update`) or which were never written (`create`): `packs/` moved on and the
 * installed copy was not regenerated yet (ADR 0022). Hand edits (`drift`) are a different
 * problem and are not counted here.
 */
export function staleEntries(plan: InstallPlan): string[] {
  const rels = plan.entries.filter((e) => e.status === "create" || e.status === "update").map((e) => e.rel);
  if (plan.hook && (plan.hook.status === "create" || plan.hook.status === "update")) rels.push(plan.hook.rel);
  return rels;
}

/** One `doctor` finding summarizing every stale installed file, or none. */
export function staleFindings(plan: InstallPlan): StaleFinding[] {
  const stale = staleEntries(plan);
  // Nothing installed yet is a setup question, not a gap between packs/ and installed copies.
  const installedSomething = plan.entries.some((e) => e.status !== "create");
  if (stale.length === 0 || !installedSomething) return [];
  return [
    {
      severity: "warn",
      message:
        `${stale.length} installed file(s) are out of date with packs/ (e.g. ${stale[0]}); ` +
        `run \`litecode install --apply --force\` (CI does it after merge on main)`,
    },
  ];
}
