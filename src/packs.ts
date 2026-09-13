import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { parseFrontmatter, parseList } from "./frontmatter.ts";

export const PackManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  /** Other packs that must also be installed for this one to make sense. */
  requires: z.array(z.string()).default([]),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

export type PackFile = {
  /** Path relative to the outDir, e.g. "agents/planner.md". */
  rel: string;
  source: string;
  /** Model tier declared in frontmatter, normalized away from provider-specific names. */
  tier?: string;
};

export type Pack = {
  manifest: PackManifest;
  dir: string;
  files: PackFile[];
};

/** Provider-neutral capability tiers. The concrete model is resolved by the runner, not the pack. */
export const TIERS = ["fast", "balanced", "reasoning"] as const;
export type Tier = (typeof TIERS)[number];

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

export async function loadPack(packsRoot: string, name: string): Promise<Pack> {
  const dir = resolve(packsRoot, name);
  const manifestFile = Bun.file(join(dir, "pack.json"));
  if (!(await manifestFile.exists())) {
    throw new Error(`Unknown pack '${name}' (no ${join(dir, "pack.json")})`);
  }
  const manifest = PackManifestSchema.parse(await manifestFile.json());

  const files: PackFile[] = [];
  for (const rel of await walk(dir)) {
    if (rel === "pack.json") continue;
    if (!rel.endsWith(".md")) continue;
    const source = await Bun.file(join(dir, rel)).text();
    const { data } = parseFrontmatter(source, `${name}/${rel}`);

    if (data.tier && !TIERS.includes(data.tier as Tier)) {
      throw new Error(
        `${name}/${rel}: tier '${data.tier}' is not one of ${TIERS.join(", ")}. ` +
          `Packs declare a capability tier, never a concrete model id.`,
      );
    }
    if (data.model) {
      throw new Error(
        `${name}/${rel}: declares 'model: ${data.model}'. Packs must declare 'tier:' instead ` +
          `so they stay portable across providers; the tier->model mapping lives in the runner config.`,
      );
    }
    files.push({ rel, source, tier: data.tier });
  }

  return { manifest, dir, files };
}

export async function listPacks(packsRoot: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(packsRoot)) {
    if (await Bun.file(join(packsRoot, entry, "pack.json")).exists()) names.push(entry);
  }
  return names.sort();
}

export { parseList };
