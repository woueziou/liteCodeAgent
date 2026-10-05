import { HANDOFF_SUPPORT, type InstallTarget, type Project } from "./config.ts";

/**
 * Closer handoff (ADR 0027, ticket 0081): whether `implementer` hands the tail of its run to a
 * fresh-context `closer` instead of doing those steps in-line.
 *
 * Semantics of `project.handoff`:
 *   - `off` (default): disabled on every target, whatever the table or override says.
 *   - `auto`: enabled for a target when `project.handoffSupport[target]` says so; with no
 *     override for that target, `HANDOFF_SUPPORT[target]` decides (all false today).
 */
export type HandoffTarget = InstallTarget | "runner";
export type HandoffDecision = { enabled: boolean; reason: string };

export function resolveHandoff(
  project: Pick<Project, "handoff" | "handoffSupport">,
  target: HandoffTarget,
): HandoffDecision {
  if (project.handoff === "off") return { enabled: false, reason: "project.handoff is off" };
  const override = project.handoffSupport[target];
  if (override !== undefined) {
    return { enabled: override, reason: `project.handoffSupport.${target} is ${override}` };
  }
  const supported = HANDOFF_SUPPORT[target];
  return { enabled: supported, reason: `${target} is ${supported ? "" : "not "}in the handoff capability table` };
}

/**
 * Template context for rendering one pack file for one target. Besides `project`, it exposes
 * the root-level boolean `handoff` (the resolved decision for THIS target), so ONE agent
 * source renders differently per target:
 *
 *   {{#if handoff}}hand the tail to the closer{{/if}}{{^if handoff}}run the in-line steps{{/if}}
 *
 * `handoff` is true only when `resolveHandoff` says enabled; a context built without it (an
 * older call site) reads as false, i.e. the in-line text. See docs/specs/closer-handoff-contract.md.
 */
export function templateContext<T>(
  project: Pick<Project, "handoff" | "handoffSupport">,
  target: HandoffTarget,
  templated: T,
): { project: T; handoff: boolean } {
  return { project: templated, handoff: resolveHandoff(project, target).enabled };
}
