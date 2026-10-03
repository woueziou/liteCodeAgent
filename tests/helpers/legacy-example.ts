/**
 * The example config plus the per-agent `agentSkills` lists a 0.x config carried. The
 * example itself no longer ships them (per-agent skill lists are not generated any more),
 * but the install pre-flight, `doctor`, `config doctor` and `upgrade` still have to handle
 * a config that has them.
 */
import { join } from "node:path";

const EXAMPLE = join(import.meta.dir, "..", "..", "examples", "ts-employee-service.litecode.config.json");

export const LEGACY_AGENT_SKILLS: Record<string, string[]> = {
  "debate-angle": ["orpc-expert", "security-expert", "typescript-expert", "frontend-expert", "critique-expert"],
  planner: ["orpc-expert", "typescript-expert", "frontend-expert"],
  implementer: ["agent-attribution", "frontend-expert", "orpc-expert", "typescript-expert", "design-expert", "ui-ux-expert", "mobile-expert", "security-expert"],
  reviewer: ["agent-attribution", "typescript-expert", "orpc-expert", "security-expert", "frontend-expert", "critique-expert"],
  triage: [],
  dispatcher: [],
  tracker: ["agent-attribution"],
};

export async function legacyExampleJson(): Promise<any> {
  const raw = await Bun.file(EXAMPLE).json();
  raw.project.agentSkills = structuredClone(LEGACY_AGENT_SKILLS);
  return raw;
}
