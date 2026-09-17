#!/usr/bin/env node
// Keeps .claude-plugin/plugin.json in lockstep with package.json.
// semantic-release bumps package.json only; the plugin manifest is what Claude Code
// installs, and tests/plugin.test.ts fails the build when the two drift apart.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, ".claude-plugin/plugin.json");

const version = process.argv[2] ?? JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const source = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(source);

if (manifest.version === version) {
  process.exit(0);
}

manifest.version = version;
const trailingNewline = source.endsWith("\n") ? "\n" : "";
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}${trailingNewline}`);
console.log(`plugin.json: ${source.match(/"version": "(.*)"/)?.[1]} -> ${version}`);
