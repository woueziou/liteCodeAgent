import { resolve, dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "./config.ts";
import { loadPack, type PackFile } from "./packs.ts";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { render, referencedPaths } from "./template.ts";
import { hash, readLockfile, writeLockfile, type Lockfile } from "./lockfile.ts";

export type PlanEntry = {
  rel: string;
  target: string;
  pack: string;
  version: string;
  content: string;
  status: "create" | "update" | "unchanged" | "drift";
};

export type InstallPlan = {
  entries: PlanEntry[];
  /** Files the previous lockfile owned that this install no longer produces. */
  orphans: string[];
  packVersions: Record<string, string>;
};

/**
 * Renders a pack file for the configured target.
 *
 * For claude-code this means: interpolate {{project.*}}, then translate the pack's
 * provider-neutral `tier:` into the frontmatter `model:` Claude Code expects.
 */
function renderFile(file: PackFile, config: Config, packName: string): string {
  const where = `${packName}/${file.rel}`;
  const rendered = render(file.source, { project: config.project }, where);
  const { data, body } = parseFrontmatter(rendered, where);

  if (data.tier) {
    const tier = data.tier as keyof Config["tiers"];
    const model = config.tiers[tier];
    if (!model) throw new Error(`${where}: no model configured for tier '${data.tier}'`);
    delete data.tier;
    data.model = model;
  }
  return serializeFrontmatter(data, body);
}

/** Config paths a set of packs requires, so a bad config fails before anything is written. */
export function requiredPaths(files: { rel: string; source: string }[]): string[] {
  const all = new Set<string>();
  for (const f of files) for (const p of referencedPaths(f.source)) all.add(p);
  return [...all].sort();
}

export async function buildPlan(
  projectRoot: string,
  packsRoot: string,
  config: Config,
): Promise<InstallPlan> {
  const previous = await readLockfile(projectRoot);
  const entries: PlanEntry[] = [];
  const packVersions: Record<string, string> = {};
  const seen = new Map<string, string>();

  for (const packName of config.packs) {
    const pack = await loadPack(packsRoot, packName);
    packVersions[pack.manifest.name] = pack.manifest.version;

    for (const missing of pack.manifest.requires.filter((r) => !config.packs.includes(r))) {
      throw new Error(`Pack '${packName}' requires pack '${missing}', which is not in config.packs`);
    }

    for (const file of pack.files) {
      const rel = join(config.outDir, file.rel);
      const owner = seen.get(rel);
      if (owner) {
        throw new Error(
          `Conflict: '${rel}' is produced by both pack '${owner}' and pack '${packName}'. ` +
            `Packs must not overwrite each other — rename one of the two files.`,
        );
      }
      seen.set(rel, packName);

      const content = renderFile(file, config, packName);
      const target = resolve(projectRoot, rel);
      const existing = Bun.file(target);
      const prior = previous?.files[rel];

      let status: PlanEntry["status"];
      if (!(await existing.exists())) {
        status = "create";
      } else {
        const onDisk = hash(await existing.text());
        if (prior && onDisk !== prior.hash) status = "drift";
        else if (onDisk === hash(content)) status = "unchanged";
        else status = "update";
      }

      entries.push({ rel, target, pack: packName, version: pack.manifest.version, content, status });
    }
  }

  const produced = new Set(entries.map((e) => e.rel));
  const orphans = Object.keys(previous?.files ?? {}).filter((rel) => !produced.has(rel));

  return { entries, orphans, packVersions };
}

export async function applyPlan(
  projectRoot: string,
  plan: InstallPlan,
  litecodeVersion: string,
  opts: { force: boolean },
): Promise<void> {
  const drifted = plan.entries.filter((e) => e.status === "drift");
  if (drifted.length > 0 && !opts.force) {
    throw new Error(
      `Refusing to overwrite ${drifted.length} file(s) edited by hand since the last install:\n` +
        drifted.map((e) => `  - ${e.rel}`).join("\n") +
        `\n\nEither move your changes upstream into the pack, or re-run with --force to discard them.`,
    );
  }

  const files: Lockfile["files"] = {};
  for (const entry of plan.entries) {
    if (entry.status !== "unchanged") {
      await mkdir(dirname(entry.target), { recursive: true });
      await Bun.write(entry.target, entry.content);
    }
    files[entry.rel] = { pack: entry.pack, version: entry.version, hash: hash(entry.content) };
  }

  await writeLockfile(projectRoot, {
    litecodeVersion,
    installedAt: new Date().toISOString(),
    packs: plan.packVersions,
    files,
  });
}
