/**
 * CSS custom properties sourced from `docs/design/litecode-design.pen`'s `"variables"` key
 * (plain JSON — the Pencil MCP isn't connected, so this reads the file directly rather than
 * through any design-tool integration). The pen file defines three token sets: `a-*` (light
 * palette, used here for `:root`), `c-*` (dark palette, used under
 * `prefers-color-scheme: dark`), and `b-*` (an alternate light palette not used by this
 * dashboard). `font-h`/`font-b`/`font-d` are the heading/body/data fonts, shared by both
 * color schemes.
 */

export const LIGHT_TOKENS: Record<string, string> = {
  "--bg": "#FFFFFF",
  "--bg2": "#F7F8FA",
  "--fg": "#1A1A1A",
  "--fg2": "#666666",
  "--muted": "#888888",
  "--border": "#1A1A1A",
  "--border2": "#EEF0F2",
  "--accent": "#4A9FD8",
  "--block": "#C62828",
  "--blockbg": "#FDECEA",
  "--ready": "#1B5E20",
  "--readybg": "#E8F5E9",
  "--human": "#E65100",
  "--humanbg": "#FFF3E0",
};

export const DARK_TOKENS: Record<string, string> = {
  "--bg": "#0B0F0B",
  "--bg2": "#121812",
  "--bg3": "#1A221A",
  "--fg": "#E8F0E8",
  "--fg2": "#8FA08F",
  "--muted": "#5A6B5A",
  "--accent": "#3DFF6E",
  "--block": "#FF5A5A",
  "--blockbg": "#2A1212",
  "--ready": "#3DFF6E",
  "--border": "#2A3A2A",
  "--sel": "#1A2E1A",
};

export const FONTS = {
  heading: "IBM Plex Mono",
  body: "Geist",
  data: "IBM Plex Mono",
};

function toCssBlock(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
}

export function tokensStylesheet(): string {
  return `
  :root {
    color-scheme: light dark;
${toCssBlock(LIGHT_TOKENS)}
    --font-heading: "${FONTS.heading}", monospace;
    --font-body: "${FONTS.body}", system-ui, sans-serif;
    --font-data: "${FONTS.data}", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
${toCssBlock(DARK_TOKENS)}
    }
  }`;
}
