/**
 * Config cleanup for `litecode upgrade` (ADR 0016): what an older release left in
 * `litecode.config.json` that nothing reads any more. Works on the file as written — the
 * raw JSON, re-serialized with its own indentation — never on the parsed config, which
 * would also write out every default the user never set.
 */

export type Json = Record<string, unknown>;

/** Config keys nothing reads any more, as paths under the config file's root object. */
const OBSOLETE_KEYS = [
  ["project", "tickets", "autoStateFile"],
  ["project", "tickets", "autoMinIntervalMs"],
  ["project", "agentSkills", "sync"],
  ["project", "board"],
] as const;

/**
 * Skills earlier packs shipped and this one doesn't. A config still naming one keeps
 * rendering it into agents' frontmatter, and install only accepts it because the old
 * installed copy passes for a local overlay — until that orphan is deleted.
 */
export const REMOVED_SKILLS = new Set(["github-project-sync"]);

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parent object holding `path`'s last key, when the whole path exists. */
function parentOf(raw: Json, path: readonly string[]): Json | undefined {
  let node: unknown = raw;
  for (const key of path.slice(0, -1)) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return isObject(node) && path.at(-1)! in node ? node : undefined;
}

function withoutObsoleteKeys(raw: Json): Json {
  const copy = structuredClone(raw);
  for (const path of OBSOLETE_KEYS) delete parentOf(copy, path)?.[path.at(-1)!];
  return copy;
}

const removedSkill = (skill: unknown) => typeof skill === "string" && REMOVED_SKILLS.has(skill);

/**
 * Removes every removed skill from `agentSkills` lists and from each angle's and domain's
 * `skills`. A domain that loses its last skill is dropped: it existed only to load that
 * skill, and the schema rejects a domain with none. An angle is never dropped — an empty
 * skill list is normal for one — and neither is any entry that was already empty or lost
 * nothing here. Mutates `raw`; returns what it did.
 */
function stripRemovedSkills(raw: Json): string[] {
  const done: string[] = [];
  const project = isObject(raw.project) ? raw.project : {};
  if (isObject(project.agentSkills)) {
    for (const [agent, list] of Object.entries(project.agentSkills)) {
      if (!Array.isArray(list)) continue;
      for (const skill of list.filter(removedSkill)) done.push(`${skill} from project.agentSkills.${agent}`);
      project.agentSkills[agent] = list.filter((skill) => !removedSkill(skill));
    }
  }
  for (const group of ["angles", "domains"] as const) {
    const entries = project[group];
    if (!Array.isArray(entries)) continue;
    project[group] = entries.filter((entry, i) => {
      if (!isObject(entry) || !Array.isArray(entry.skills)) return true;
      const name = typeof entry.name === "string" ? entry.name : typeof entry.match === "string" ? entry.match : "";
      const label = `project.${group}[${i}]${name ? ` (${name})` : ""}`;
      const removed = entry.skills.filter(removedSkill);
      if (removed.length === 0) return true;
      for (const skill of removed) done.push(`${skill} from ${label}`);
      entry.skills = entry.skills.filter((skill) => !removedSkill(skill));
      if (group === "angles" || (entry.skills as unknown[]).length > 0) return true;
      done.push(`${label}, left with no skill`);
      return false;
    });
  }
  return done;
}

/** What `cleanedConfig` would remove, as human-readable items; empty when nothing. */
export function obsoleteConfig(raw: Json): string[] {
  const keys = OBSOLETE_KEYS.filter((path) => parentOf(raw, path)).map((path) => path.join("."));
  // Skills under a key that is itself going away aren't worth listing twice.
  return [...keys, ...stripRemovedSkills(withoutObsoleteKeys(raw))];
}

/** A copy of the raw config with every obsolete key and removed skill taken out. */
export function cleanedConfig(raw: Json): Json {
  const copy = withoutObsoleteKeys(raw);
  stripRemovedSkills(copy);
  return copy;
}

/**
 * Serializes `value` close to how `original` was written, so a rewrite mostly shows the
 * keys it removed: the file's indentation unit (the step between consecutive nesting
 * levels it uses most), minified if it was on one line, CRLF if it had them, and its
 * trailing newline or lack of one. Standard `JSON.stringify` layout otherwise — a
 * hand-aligned file will still show some reformatting.
 */
export function formatLike(original: string, value: unknown): string {
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const trailing = /\r?\n$/.test(original) ? eol : "";
  const body = original.trim();
  if (!body.includes("\n")) return JSON.stringify(value) + trailing;
  const indents = [...body.matchAll(/^([ \t]*)\S/gm)].map((m) => m[1]!);
  const indented = indents.filter((i) => i !== "");
  const tabs = indented.filter((i) => i.includes("\t")).length > indented.length / 2;
  const steps = new Map<number, number>();
  for (let i = 1; i < indents.length; i++) {
    const step = indents[i]!.length - indents[i - 1]!.length;
    if (step > 0) steps.set(step, (steps.get(step) ?? 0) + 1);
  }
  const unit = [...steps].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 2;
  const text = JSON.stringify(value, null, tabs ? "\t" : unit);
  return text.replace(/\n/g, eol) + trailing;
}
