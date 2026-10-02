import type { Config } from "./config.ts";
import { loadPack } from "./packs.ts";
import { missingAgentSkillPaths, type MissingConfigPath } from "./install.ts";
import { deriveAgentSkills } from "./init.ts";
import type { Detected } from "./detect.ts";

export type Finding = { severity: "error" | "warn"; message: string };

async function packFilesAndSkills(
  packsRoot: string,
  packNames: string[],
): Promise<{ files: { rel: string; source: string; packName: string }[]; packSkills: Set<string> }> {
  const files: { rel: string; source: string; packName: string }[] = [];
  const packSkills = new Set<string>();
  for (const packName of packNames) {
    const pack = await loadPack(packsRoot, packName);
    for (const file of pack.files) {
      files.push({ ...file, packName });
      const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.rel);
      if (match?.[1]) packSkills.add(match[1]);
    }
  }
  return { files, packSkills };
}

/** Missing `project.agentSkills.*` leaves the installed packs require. Follows ADR 0006's scope. */
export async function findMissingAgentSkills(packsRoot: string, config: Config): Promise<MissingConfigPath[]> {
  const { files } = await packFilesAndSkills(packsRoot, config.packs);
  return missingAgentSkillPaths(files, config.project.agentSkills);
}

/**
 * Reports what's wrong. Never mutates anything — see `computeAgentSkillsFix` for the opt-in repair.
 */
export async function doctor(packsRoot: string, config: Config): Promise<Finding[]> {
  const missing = await findMissingAgentSkills(packsRoot, config);
  return missing.map((m) => ({
    severity: "error" as const,
    message: `${m.path} is missing (referenced by ${m.sources.join(", ")})`,
  }));
}

/**
 * Derives values for exactly the missing `agentSkills` keys, reusing the same mechanical
 * derivation `init` uses so a repair never invents a skill list a human didn't already
 * approve the shape of via angles/domains. Returns {} when nothing is missing.
 */
export async function computeAgentSkillsFix(
  packsRoot: string,
  config: Config,
): Promise<Record<string, string[]>> {
  const missing = await findMissingAgentSkills(packsRoot, config);
  if (missing.length === 0) return {};
  const { packSkills } = await packFilesAndSkills(packsRoot, config.packs);
  const derived = deriveAgentSkills(config.project.angles, config.project.domains, packSkills);
  const fix: Record<string, string[]> = {};
  for (const { path } of missing) {
    const key = path.slice("project.agentSkills.".length);
    fix[key] = derived[key] ?? [];
  }
  return fix;
}

/**
 * Checks the routing rules (Domain, stored as `domains`): every skill a rule names must be in
 * an installed pack or a project-local skill, and every detected technology should have a rule.
 * A technology is covered when some rule's `match` text mentions it.
 */
export async function routingFindings(packsRoot: string, config: Config, detected: Detected): Promise<Finding[]> {
  const rules = config.project.domains;
  if (rules.length === 0) {
    return [
      {
        severity: "warn",
        message: "no routing rule: agents will not load any skill on demand — add one with `litecode config edit`",
      },
    ];
  }
  const { packSkills } = await packFilesAndSkills(packsRoot, config.packs);
  const available = new Set([...packSkills, ...detected.localSkills]);
  const findings: Finding[] = [];
  for (const rule of rules) {
    for (const skill of rule.skills) {
      if (!available.has(skill)) {
        findings.push({
          severity: "error",
          message: `routing rule "${rule.match}" names skill '${skill}', which is not in the installed packs (${config.packs.join(", ")}) or the project's own skills`,
        });
      }
    }
  }
  const covered = (term: string) => rules.some((r) => r.match.toLowerCase().includes(term.toLowerCase()));
  const { stack } = detected;
  const technologies: [string | undefined, string][] = [
    [stack.api, "API layer"],
    [stack.webAppDir, "web app"],
    [stack.hasAuth ? "auth" : undefined, "authentication"],
  ];
  for (const [term, label] of technologies) {
    if (term && !covered(term)) {
      findings.push({
        severity: "warn",
        message: `${label} detected (${term}) but no routing rule mentions it — add a rule so its skills load on demand`,
      });
    }
  }
  return findings;
}
