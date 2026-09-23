/**
 * Minimal, dependency-free template renderer for pack files.
 *
 * Supported syntax (deliberately tiny — pack authors write prose, not programs):
 *   {{ a.b.c }}                 interpolate a string/number
 *   {{#if a.b}} ... {{/if}}     include block when truthy (non-empty array/string/object)
 *   {{^if a.b}} ... {{/if}}     include block when falsy
 *   {{#each a.b}} ... {{/each}} repeat block; inside, {{.}} is the item,
 *                               {{ field }} resolves against the item first, then the root
 *   {{> name arg}}              call a helper supplied by the caller (e.g. the install
 *                               target's delegation wording); an unknown helper is an error
 *
 * Anything unresolved is a hard error, never a silently empty string: a prompt with a
 * hole in it is worse than a build that fails.
 */

export class TemplateError extends Error {}

type Ctx = Record<string, unknown>;

/** Text a caller computes at render time, e.g. per install target. `arg` may be empty. */
export type Helpers = Record<string, (arg: string) => string>;

/**
 * Holds the current {{#each}} item so `{{ . }}` works for primitive items too — an item
 * that is a plain string has no properties to become a scope on its own.
 */
const ITEM = Symbol.for("litecode.template.item");

function lookup(path: string, scopes: Ctx[]): unknown {
  const key = path.trim();
  if (key === ".") {
    const scope = scopes[0];
    if (scope && ITEM in scope) return (scope as Record<symbol, unknown>)[ITEM];
    return scope;
  }
  for (const scope of scopes) {
    let cur: unknown = scope;
    let ok = true;
    for (const part of key.split(".")) {
      if (cur !== null && typeof cur === "object" && part in (cur as Ctx)) {
        cur = (cur as Ctx)[part];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur !== undefined) return cur;
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function stringify(v: unknown, path: string, where: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new TemplateError(
    `${where}: {{ ${path} }} resolved to ${Array.isArray(v) ? "an array" : typeof v}, which cannot be interpolated as text`,
  );
}

const BLOCK = /\{\{([#^])(if|each)\s+([^}]+?)\}\}/;

function renderScope(tpl: string, scopes: Ctx[], where: string, helpers: Helpers): string {
  const m = BLOCK.exec(tpl);
  if (!m) return renderLeaf(tpl, scopes, where, helpers);

  const [openTag, sigil, kind, rawPath] = m as unknown as [string, string, "if" | "each", string];
  const start = m.index;
  const closeTag = `{{/${kind}}}`;

  // Find the matching close tag, accounting for nested blocks of the same kind.
  let depth = 1;
  let cursor = start + openTag.length;
  let end = -1;
  while (cursor < tpl.length) {
    const nextOpen = tpl.slice(cursor).search(new RegExp(`\\{\\{[#^]${kind}\\s`));
    const nextClose = tpl.indexOf(closeTag, cursor);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && cursor + nextOpen < nextClose) {
      depth++;
      cursor = cursor + nextOpen + 2;
      continue;
    }
    depth--;
    if (depth === 0) {
      end = nextClose;
      break;
    }
    cursor = nextClose + closeTag.length;
  }
  if (end === -1) throw new TemplateError(`${where}: unclosed {{#${kind} ${rawPath.trim()}}}`);

  const before = tpl.slice(0, start);
  const body = tpl.slice(start + openTag.length, end);
  const after = tpl.slice(end + closeTag.length);
  const value = lookup(rawPath, scopes);

  let rendered = "";
  if (kind === "if") {
    const keep = sigil === "#" ? truthy(value) : !truthy(value);
    if (keep) rendered = renderScope(body, scopes, where, helpers);
  } else {
    if (sigil === "^") throw new TemplateError(`${where}: {{^each}} is not supported`);
    if (value !== undefined && !Array.isArray(value)) {
      throw new TemplateError(`${where}: {{#each ${rawPath.trim()}}} expects an array`);
    }
    for (const item of (value as unknown[]) ?? []) {
      const itemScope: Ctx =
        item !== null && typeof item === "object" ? { ...(item as Ctx) } : {};
      (itemScope as Record<symbol, unknown>)[ITEM] = item;
      rendered += renderScope(body, [itemScope, ...scopes], where, helpers);
    }
  }

  return renderLeaf(before, scopes, where, helpers) + rendered + renderScope(after, scopes, where, helpers);
}

const HELPER = /^>\s*([A-Za-z][\w-]*)(?:\s+(.*))?$/;

function renderLeaf(tpl: string, scopes: Ctx[], where: string, helpers: Helpers): string {
  return tpl.replace(/\{\{([^#^/][^}]*)\}\}/g, (_full, rawExpr: string) => {
    const call = HELPER.exec(rawExpr.trim());
    if (call) {
      const helper = helpers[call[1]!];
      if (!helper) throw new TemplateError(`${where}: unknown helper '{{> ${call[1]}}}'`);
      return helper((call[2] ?? "").trim());
    }
    const [rawPath, filter] = rawExpr.split("|").map((s) => s.trim());
    const value = lookup(rawPath ?? "", scopes);
    if (value === undefined) {
      throw new TemplateError(`${where}: {{ ${rawExpr.trim()} }} is not defined in the project config`);
    }
    if (filter === "join" || filter === "codelist") {
      if (!Array.isArray(value)) {
        throw new TemplateError(`${where}: {{ ${rawPath} | ${filter} }} expects an array`);
      }
      const parts = value.map((v) => stringify(v, rawPath ?? "", where));
      return filter === "codelist" ? parts.map((v) => `\`${v}\``).join(", ") : parts.join(", ");
    }
    if (filter) throw new TemplateError(`${where}: unknown filter '${filter}'`);
    return stringify(value, rawPath ?? "", where);
  });
}

/**
 * A block tag alone on its line is structural, not content: it should not leave the
 * blank line behind after the block is expanded. Same rule Mustache calls "standalone tags".
 */
function stripStandaloneTags(tpl: string): string {
  return tpl.replace(/^[ \t]*(\{\{[#^/][^}]*\}\})[ \t]*\r?\n/gm, "$1");
}

export function render(tpl: string, ctx: Ctx, where = "template", helpers: Helpers = {}): string {
  return renderScope(stripStandaloneTags(tpl), [ctx], where, helpers);
}

const LEAF = /\{\{([^#^/][^}]*)\}\}/g;

/**
 * Walks the same block structure `renderScope` does, but only to collect paths, never to
 * render. A path found strictly inside an `{{#each}}` body that isn't root-qualified
 * (doesn't start with `project.`) is item-scoped — `renderLeaf`/`lookup` would resolve it
 * against the loop item first, so it is not a required root config path and must not be
 * reported as one. The `{{#each ...}}`/`{{#if ...}}` condition path itself is always a
 * real reference and is collected regardless of nesting.
 */
function collectPaths(tpl: string, insideEach: boolean, out: Set<string>): void {
  const m = BLOCK.exec(tpl);
  if (!m) {
    for (const leaf of tpl.matchAll(LEAF)) {
      const rawExpr = leaf[1] ?? "";
      const [rawPath] = rawExpr.split("|").map((s) => s.trim());
      const path = (rawPath ?? "").trim();
      // Helper calls (`{{> name arg}}`) are computed by the caller, not read from config.
      if (!path || path === "." || path.startsWith("/") || path.startsWith(">")) continue;
      if (insideEach && !path.startsWith("project.")) continue;
      out.add(path);
    }
    return;
  }

  const [openTag, , kind, rawPath] = m as unknown as [string, string, "if" | "each", string];
  const start = m.index;
  const closeTag = `{{/${kind}}}`;

  let depth = 1;
  let cursor = start + openTag.length;
  let end = -1;
  while (cursor < tpl.length) {
    const nextOpen = tpl.slice(cursor).search(new RegExp(`\\{\\{[#^]${kind}\\s`));
    const nextClose = tpl.indexOf(closeTag, cursor);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && cursor + nextOpen < nextClose) {
      depth++;
      cursor = cursor + nextOpen + 2;
      continue;
    }
    depth--;
    if (depth === 0) {
      end = nextClose;
      break;
    }
    cursor = nextClose + closeTag.length;
  }
  if (end === -1) {
    // Unclosed block: mirror render()'s eventual TemplateError by not guessing past it.
    collectPaths(tpl.slice(0, start), insideEach, out);
    return;
  }

  const before = tpl.slice(0, start);
  const body = tpl.slice(start + openTag.length, end);
  const after = tpl.slice(end + closeTag.length);

  collectPaths(before, insideEach, out);
  const condPath = rawPath.trim();
  if (condPath && condPath !== "." && (!insideEach || condPath.startsWith("project."))) {
    out.add(condPath);
  }
  collectPaths(body, insideEach || kind === "each", out);
  collectPaths(after, insideEach, out);
}

/** Every {{ ... }} path a template references, for pre-flight config validation. */
export function referencedPaths(tpl: string): string[] {
  const out = new Set<string>();
  collectPaths(tpl, false, out);
  return [...out];
}
