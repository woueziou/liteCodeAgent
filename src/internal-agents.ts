import type { InstallTarget } from "./config.ts";

/**
 * Agents only `orchestrator` calls (ticket 0073). Announcing them in every session costs
 * tokens for nothing. See docs/agent-visibility.md for the per-target mechanism.
 */
export const INTERNAL_AGENTS: ReadonlySet<string> = new Set([
  "classifier",
  "panel-selector",
  "debate-angle",
  "synthesizer",
  "planner",
]);

/** Targets with a documented frontmatter switch that hides a subagent from the session. */
const HIDING_TARGETS: ReadonlySet<InstallTarget> = new Set(["opencode"]);

export function shouldHideAgent(target: InstallTarget, name: string): boolean {
  return HIDING_TARGETS.has(target) && INTERNAL_AGENTS.has(name);
}
