/**
 * Escaping helpers shared by every `render-*.ts` screen module. All free-text ticket/ADR
 * content (titles, bodies) is user/agent-authored and must be escaped — it can legitimately
 * contain backticks, angle brackets, quotes, Markdown. These are the only place that
 * happens; every interpolation of ticket/ADR content in a `render-*.ts` file must go
 * through one of these.
 */

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes text for use inside a double-quoted HTML attribute. Same rule as element text. */
export function escapeAttr(input: string): string {
  return escapeHtml(input);
}
