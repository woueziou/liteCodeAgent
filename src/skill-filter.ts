/**
 * Expertise skills (`install: referenced` in their frontmatter) are announced in every
 * session's context, so they are only installed when something uses them: an installed
 * agent lists them, or the config asks for them (ticket 0068). Other skills — the ones a
 * human invokes by name — are always installed.
 */
import type { Config } from "./config.ts";

/** The frontmatter key marking a skill as install-on-reference. Never written to the output. */
export const INSTALL_KEY = "install";

/** Every skill name the config asks for, through an angle or a Domain rule. */
export function configSkills(project: Config["project"]): string[] {
  return [
    ...project.angles.flatMap((angle) => angle.skills),
    ...project.domains.flatMap((domain) => domain.skills),
  ];
}

/** Whether a skill file should be left out: marked install-on-reference and nobody wants it. */
export function skipSkill(data: Record<string, string>, name: string, wanted: ReadonlySet<string>): boolean {
  return data[INSTALL_KEY] === "referenced" && !wanted.has(name);
}

/** The frontmatter to write out: everything but the install marker. */
export function withoutInstallKey(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => key !== INSTALL_KEY));
}

/**
 * `install: handoff` marks a pack file (the `closer` agent and the references only it and the
 * handoff text of `implementer` read) that exists only where the closer handoff is enabled for
 * the target (ADR 0027, ticket 0081). With it disabled the file is neither rendered nor installed,
 * so the default install plan, the lockfile and every session's announced agents stay as they were.
 */
export const INSTALL_HANDOFF = "handoff";

export function skipForHandoff(data: Record<string, string>, handoffEnabled: boolean): boolean {
  return data[INSTALL_KEY] === INSTALL_HANDOFF && !handoffEnabled;
}
