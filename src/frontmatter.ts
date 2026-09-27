/**
 * Frontmatter parsing for pack files. Intentionally handles only the shapes agent/skill
 * files actually use (scalars and comma-separated lists) rather than pulling in a YAML
 * dependency — a pack file with exotic YAML in its frontmatter is a bug, not a feature.
 */

export type Frontmatter = Record<string, string>;

/**
 * The terminator must be a line that *is* `---`, not merely a line that starts with it —
 * otherwise a ticket/pack body containing a markdown horizontal rule (`---`) inside a
 * larger line, or a body that legitimately opens with `---` prose, silently truncates or
 * misparses. We scan line by line rather than regex-searching the raw string for `\n---`.
 */
function findTerminator(lines: string[]): number {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") return i;
  }
  return -1;
}

export function parseFrontmatter(source: string, where: string): { data: Frontmatter; body: string } {
  if (!source.startsWith("---\n")) {
    throw new Error(`${where}: missing frontmatter (file must start with '---')`);
  }
  const lines = source.split("\n");
  const end = findTerminator(lines);
  if (end === -1) throw new Error(`${where}: unterminated frontmatter`);

  const raw = lines.slice(1, end).join("\n");
  const body = lines.slice(end + 1).join("\n");

  const data: Frontmatter = {};
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const sep = line.indexOf(":");
    if (sep === -1) throw new Error(`${where}: unparseable frontmatter line: ${line}`);
    data[line.slice(0, sep).trim()] = unquote(line.slice(sep + 1).trim());
  }
  return { data, body };
}

/** Reads back a value `quote` wrapped, or one a human quoted by hand. */
function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

/**
 * Our parser is lenient, but editors and other tools read these files as real YAML, where
 * `title: fix(cli): x` is a nested mapping, not a string. Anything a YAML plain scalar
 * can't carry is written double-quoted; a JSON string is a valid YAML double-quoted one.
 */
function quote(value: string): string {
  const unsafe = /: |:$| #|^\s|\s$/.test(value) || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value);
  return unsafe ? JSON.stringify(value) : value;
}

export function serializeFrontmatter(data: Frontmatter, body: string): string {
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${quote(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
