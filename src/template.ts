/**
 * Minimal, dependency-free template renderer for pack files.
 *
 * Supported syntax (deliberately tiny — pack authors write prose, not programs):
 *   {{ a.b.c }}                 interpolate a string/number
 *   {{#if a.b}} ... {{/if}}     include block when truthy (non-empty array/string/object)
 *   {{^if a.b}} ... {{/if}}     include block when falsy
 *   {{#each a.b}} ... {{/each}} repeat block; inside, {{.}} is the item,
 *                               {{ field }} resolves against the item first, then the root
 *
 * Anything unresolved is a hard error, never a silently empty string: a prompt with a
 * hole in it is worse than a build that fails.
 */

export class TemplateError extends Error {}

type Ctx = Record<string, unknown>;

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

function renderScope(tpl: string, scopes: Ctx[], where: string): string {
  const m = BLOCK.exec(tpl);
  if (!m) return renderLeaf(tpl, scopes, where);

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
    if (keep) rendered = renderScope(body, scopes, where);
  } else {
    if (sigil === "^") throw new TemplateError(`${where}: {{^each}} is not supported`);
    if (value !== undefined && !Array.isArray(value)) {
      throw new TemplateError(`${where}: {{#each ${rawPath.trim()}}} expects an array`);
    }
    for (const item of (value as unknown[]) ?? []) {
      const itemScope: Ctx =
        item !== null && typeof item === "object" ? { ...(item as Ctx) } : {};
      (itemScope as Record<symbol, unknown>)[ITEM] = item;
      rendered += renderScope(body, [itemScope, ...scopes], where);
    }
  }

  return renderLeaf(before, scopes, where) + rendered + renderScope(after, scopes, where);
}

function renderLeaf(tpl: string, scopes: Ctx[], where: string): string {
  return tpl.replace(/\{\{([^#^/][^}]*)\}\}/g, (_full, rawExpr: string) => {
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

export function render(tpl: string, ctx: Ctx, where = "template"): string {
  return renderScope(stripStandaloneTags(tpl), [ctx], where);
}

/** Every {{ ... }} path a template references, for pre-flight config validation. */
export function referencedPaths(tpl: string): string[] {
  const out = new Set<string>();
  for (const m of tpl.matchAll(/\{\{[#^]?(?:if|each)?\s*([^}/][^}]*)\}\}/g)) {
    const p = (m[1] ?? "").trim();
    if (p && p !== "." && !p.startsWith("/")) out.add(p.replace(/^(?:if|each)\s+/, ""));
  }
  return [...out];
}
