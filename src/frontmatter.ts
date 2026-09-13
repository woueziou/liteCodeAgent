/**
 * Frontmatter parsing for pack files. Intentionally handles only the shapes agent/skill
 * files actually use (scalars and comma-separated lists) rather than pulling in a YAML
 * dependency — a pack file with exotic YAML in its frontmatter is a bug, not a feature.
 */

export type Frontmatter = Record<string, string>;

export function parseFrontmatter(source: string, where: string): { data: Frontmatter; body: string } {
  if (!source.startsWith("---\n")) {
    throw new Error(`${where}: missing frontmatter (file must start with '---')`);
  }
  const end = source.indexOf("\n---", 3);
  if (end === -1) throw new Error(`${where}: unterminated frontmatter`);

  const raw = source.slice(4, end);
  const body = source.slice(source.indexOf("\n", end + 1) + 1);

  const data: Frontmatter = {};
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`${where}: unparseable frontmatter line: ${line}`);
    data[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return { data, body };
}

export function serializeFrontmatter(data: Frontmatter, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
