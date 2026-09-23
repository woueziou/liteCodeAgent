/**
 * `litecode upgrade`, for a project: everything an existing install needs after a new
 * release, in one command (ADR 0016). Each migration inspects the project and proposes
 * only the changes it actually needs, so a project that is already current gets an empty
 * plan and re-running the command is harmless. A future breaking release adds its own
 * migration to `MIGRATIONS` rather than asking users for another manual step.
 *
 * Planning never writes anything; `applyUpgrade` runs the planned changes in order. The
 * CLI shows the plan and asks before applying it. Nothing is ever deleted outside the
 * project, and nothing a user may have edited is deleted without proof it wasn't.
 */

import { lstat, readdir, realpath, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { CONFIG_FILENAME, ConfigSchema, TARGETS, type Config } from "./config.ts";
import { applyPlan, buildPlan, lockPath, SKILL_ROOTS } from "./install.ts";
import { hash, readLockfile } from "./lockfile.ts";
import { cleanedConfig, formatLike, isObject, obsoleteConfig, REMOVED_SKILLS, type Json } from "./project-upgrade-config.ts";
import { listTicketsDetailed, writeTicket } from "./tickets/store.ts";
import { CURRENT_SCHEMA_VERSION, migrateTicket, unknownKeys } from "./tickets/spec.ts";

export type UpgradeContext = {
  root: string;
  config: Config;
  packsRoot: string;
  litecodeVersion: string;
};

/**
 * One thing the upgrade will do. `apply` runs only after the user has seen the plan;
 * `details` lists what a change covers when that doesn't fit on one line.
 */
export type Change = { summary: string; details?: string[]; apply: () => Promise<void> };

/** Something the upgrade deliberately leaves alone, and why — shown so nothing is silent. */
export type Skip = { summary: string; reason: string };

export type MigrationPlan = { id: string; title: string; changes: Change[]; skipped: Skip[] };

type Migration = { id: string; title: string; plan: (ctx: UpgradeContext) => Promise<MigrationPlan> };

const exists = (path: string) => Bun.file(path).exists();

const isInside = (root: string, path: string) => {
  const fromRoot = relative(root, path);
  return fromRoot !== "" && !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
};

/** The nearest existing ancestor of `path` (itself included), with symlinks resolved. */
async function realAncestor(path: string): Promise<string> {
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      return await realpath(dir);
    } catch {
      if (dirname(dir) === dir) return dir;
    }
  }
}

/**
 * `rel` resolved against the project root, or `null` when it points outside it. Paths come
 * from committed files (config, lockfiles) that nobody reviews for this, so a `../`, an
 * absolute path, or a symlinked directory leading out of the project must never reach
 * `rm`. The check is made on the real location of the file's directory; the file itself
 * may be a symlink, since `rm` removes the link, not what it points to.
 */
async function insideProject(root: string, rel: string): Promise<string | null> {
  const path = resolve(root, rel);
  if (!isInside(root, path)) return null;
  const realRoot = await realAncestor(root);
  return isInside(realRoot, join(await realAncestor(dirname(path)), relative(dirname(path), path))) ? path : null;
}

/**
 * Removes `dir` if deleting a file left it empty, and only then — and only a real
 * directory: a symlinked one is the user's layout, not something this release created.
 * Best-effort: the file it held is already gone, so a failure here must not be reported
 * as if that deletion hadn't happened.
 */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    if ((await lstat(dir)).isDirectory() && (await readdir(dir)).length === 0) await rmdir(dir);
  } catch {
    // Leaving an empty folder behind is harmless.
  }
}

/**
 * Deletes `path` only if its content still hashes to `expected` — checked again at apply
 * time, since the user may have edited the file while reading the plan — then removes
 * its directory if that left it empty (a removed skill's folder, say).
 */
async function deleteIfUnchanged(path: string, expected: string, rel: string): Promise<void> {
  if (!(await exists(path))) return;
  if (hash(await Bun.file(path).text()) !== expected) {
    throw new Error(`${rel} changed since the plan was shown; left in place`);
  }
  await rm(path);
  await removeIfEmpty(dirname(path));
}

/** The re-render plan, shared by `packs` and `orphans`: orphans wait on a clean re-render. */
async function renderPlan(ctx: UpgradeContext) {
  const plan = await buildPlan(ctx.root, ctx.packsRoot, ctx.config);
  return { plan, drifted: plan.entries.filter((e) => e.status === "drift") };
}

/** Re-renders every installed agent, skill and command for the configured tools. */
const renderPacks: Migration = {
  id: "packs",
  title: "Re-render installed agents and skills",
  async plan(ctx) {
    const { plan, drifted } = await renderPlan(ctx);
    const changed = plan.entries.filter((e) => e.status === "create" || e.status === "update");
    const base = { id: this.id, title: this.title };
    if (drifted.length > 0) {
      return {
        ...base,
        changes: [],
        skipped: [
          {
            summary: `${changed.length + drifted.length} file(s) not re-rendered`,
            reason:
              `${drifted.length} were edited by hand (${drifted.map((e) => e.rel).join(", ")}). ` +
              "Move those edits upstream into the pack, or run `litecode install --apply --force` to discard them, then run `upgrade` again.",
          },
        ],
      };
    }
    if (changed.length === 0) return { ...base, changes: [], skipped: [] };
    const creates = changed.filter((e) => e.status === "create").length;
    return {
      ...base,
      changes: [
        {
          summary: `write ${changed.length} file(s) (${creates} new, ${changed.length - creates} updated)`,
          apply: () => applyPlan(ctx.root, plan, ctx.litecodeVersion, { force: false }),
        },
      ],
      skipped: [],
    };
  },
};

/** Agents no release produces any more. */
const REMOVED_AGENTS = ["sync"];

/**
 * Where earlier releases installed the removed agents and skills, per tool — needed on
 * top of the lockfile, because a project that ran `install --apply` on a newer release
 * already had those entries dropped from its lockfile while the files stayed on disk.
 */
function removedFileLocations(config: Config): string[] {
  const agents = REMOVED_AGENTS.flatMap((name) => [
    join(config.outDir, "agents", `${name}.md`),
    `.codex/agents/${name}.toml`,
    `.opencode/agents/${name}.md`,
    `.kilo/agents/${name}.md`,
  ]);
  const skills = [...REMOVED_SKILLS].flatMap((name) => [
    join(config.outDir, "skills", name, "SKILL.md"),
    ...TARGETS.filter((t) => t !== "claude-code").map((t) => join(SKILL_ROOTS[t], "skills", name, "SKILL.md")),
  ]);
  return [...agents, ...skills];
}

/**
 * Removes files an earlier version generated and this one no longer produces (the `sync`
 * agent's copies, say) — but only when they still match the hash their lockfile recorded.
 * A file someone edited since is kept, and so is one no lockfile vouches for any more: no
 * hash, no proof it's untouched. Nothing is deleted while the re-render is blocked by a
 * hand-edited file, since the agents it would have rewritten may still reference them.
 */
const removeOrphans: Migration = {
  id: "orphans",
  title: "Remove files earlier versions generated",
  async plan(ctx) {
    const { plan, drifted } = await renderPlan(ctx);
    const recorded = new Map<string, string>();
    for (const target of TARGETS) {
      const lock = await readLockfile(ctx.root, lockPath(target));
      for (const [rel, entry] of Object.entries(lock?.files ?? {})) recorded.set(rel, entry.hash);
    }
    const candidates = [...new Set([...plan.orphans, ...removedFileLocations(ctx.config)])];
    const changes: Change[] = [];
    const skipped: Skip[] = [];
    for (const rel of candidates) {
      // Only files that are actually there are worth judging, or reporting.
      if (!(await lstat(resolve(ctx.root, rel)).catch(() => null))) continue;
      const path = await insideProject(ctx.root, rel);
      if (!path) {
        skipped.push({ summary: `ignore ${rel}`, reason: "points outside the project; upgrade never deletes there" });
        continue;
      }
      const expected = recorded.get(rel);
      if (drifted.length > 0) {
        skipped.push({
          summary: `keep ${rel} for now`,
          reason: "the re-render is blocked (see above); run `upgrade` again once it can go ahead",
        });
      } else if (expected === undefined) {
        skipped.push({
          summary: `keep ${rel}`,
          reason:
            "left by an earlier release, but no lockfile records it any more, so upgrade can't tell " +
            "whether you edited it — delete it yourself if you don't need it",
        });
      } else if (hash(await Bun.file(path).text()) !== expected) {
        skipped.push({ summary: `keep ${rel}`, reason: "edited since it was generated; delete it yourself if you don't need it" });
      } else {
        changes.push({ summary: `delete ${rel}`, apply: () => deleteIfUnchanged(path, expected, rel) });
      }
    }
    return { id: this.id, title: this.title, changes, skipped };
  },
};

/** Rewrites schema-v1 (GitHub-synced) tickets as local-only v2 (ADR 0015). */
const migrateTickets: Migration = {
  id: "tickets",
  title: `Migrate tickets to schema v${CURRENT_SCHEMA_VERSION}`,
  async plan(ctx) {
    const base = { id: this.id, title: this.title };
    if (!ctx.config.project.tickets.enabled) return { ...base, changes: [], skipped: [] };
    const { tickets, errors } = await listTicketsDetailed(ctx.root, ctx.config.project.tickets.dir);
    const changes: Change[] = [];
    const skipped: Skip[] = errors.map((e) => ({
      summary: `leave ${e.path} as it is`,
      reason: `it isn't a valid ticket — run \`litecode ticket doctor\` for details, fix it, then run \`upgrade\` again`,
    }));
    for (const ticket of tickets.filter((t) => t.schemaVersion < CURRENT_SCHEMA_VERSION)) {
      const extra = unknownKeys(await Bun.file(resolve(ctx.root, ticket.path)).text(), ticket.path);
      if (extra.length > 0) {
        skipped.push({
          summary: `leave ${ticket.path} at v${ticket.schemaVersion}`,
          reason:
            `its frontmatter has key(s) v${CURRENT_SCHEMA_VERSION} would drop (${extra.join(", ")}). ` +
            "Move them into the body, or run `litecode ticket migrate --apply --force`",
        });
      } else {
        changes.push({ summary: `migrate ${ticket.path}`, apply: () => writeTicket(ctx.root, migrateTicket(ticket)) });
      }
    }
    return { ...base, changes, skipped };
  },
};

async function readRawConfig(root: string): Promise<{ raw: Json; text: string }> {
  const text = await Bun.file(resolve(root, CONFIG_FILENAME)).text();
  return { raw: JSON.parse(text) as Json, text };
}

/** Removes obsolete settings and removed skills from the config file, keeping its indentation. */
const cleanConfig: Migration = {
  id: "config",
  title: `Remove obsolete settings from ${CONFIG_FILENAME}`,
  async plan(ctx) {
    const { raw, text } = await readRawConfig(ctx.root);
    const found = obsoleteConfig(raw);
    const changes: Change[] =
      found.length === 0
        ? []
        : [
            {
              summary: `remove ${found.length} obsolete setting(s)`,
              details: found,
              async apply() {
                await Bun.write(resolve(ctx.root, CONFIG_FILENAME), formatLike(text, cleanedConfig(raw)));
              },
            },
          ];
    return { id: this.id, title: this.title, changes, skipped: [] };
  },
};

/** Default locations of the data files the board commands and the ticket sync wrote. */
const LEGACY_DATA_FILES = [
  ".claude/data/board.json",
  ".claude/data/github-project-item-ids.json",
  ".claude/data/ticket-sync-auto-state.json",
];

/**
 * Data files the board commands and the ticket sync wrote, at their default paths or the
 * ones the config named for them (read before `cleanConfig` removes those keys). They're
 * caches nobody edits by hand, but a configured path is still held to the project.
 */
const removeLegacyData: Migration = {
  id: "legacy-data",
  title: "Delete data files of removed features",
  async plan(ctx) {
    const { raw } = await readRawConfig(ctx.root);
    const project = isObject(raw.project) ? raw.project : {};
    const board = isObject(project.board) ? project.board : {};
    const tickets = isObject(project.tickets) ? project.tickets : {};
    const configured = [board.dataFile, board.itemIdCache, tickets.autoStateFile].filter(
      (v): v is string => typeof v === "string" && v !== "",
    );
    const changes: Change[] = [];
    const skipped: Skip[] = [];
    const seen = new Set<string>();
    for (const rel of [...LEGACY_DATA_FILES, ...configured]) {
      // `./x` and `x` are the same file: plan it once, or the second delete fails.
      const resolved = resolve(ctx.root, rel);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      if (!(await lstat(resolved).catch(() => null))) continue;
      const path = await insideProject(ctx.root, rel);
      const stat = path ? await lstat(path).catch(() => null) : null;
      if (!path) {
        skipped.push({ summary: `ignore ${rel}`, reason: "points outside the project; upgrade never deletes there" });
      } else if (stat && !stat.isFile() && !stat.isSymbolicLink()) {
        skipped.push({ summary: `keep ${rel}`, reason: "it's not a file; delete it yourself if it's the old cache" });
      } else if (stat) {
        changes.push({
          summary: `delete ${rel}`,
          async apply() {
            await rm(path);
            await removeIfEmpty(dirname(path));
          },
        });
      }
    }
    return { id: this.id, title: this.title, changes, skipped };
  },
};

/**
 * In apply order. Config cleanup comes first, and every later migration is planned
 * against the cleaned config (see `planUpgrade`), so agents are re-rendered without a
 * reference to a removed skill. Legacy data paths are read from the file as it still is.
 */
export const MIGRATIONS: Migration[] = [cleanConfig, renderPacks, removeOrphans, migrateTickets, removeLegacyData];

/**
 * Plans every migration. `ctx.config` is replaced by the config as it will be once
 * `cleanConfig` has run, so nothing later is planned against settings about to go away.
 */
export async function planUpgrade(ctx: UpgradeContext): Promise<MigrationPlan[]> {
  const cleaned = ConfigSchema.safeParse(cleanedConfig((await readRawConfig(ctx.root)).raw));
  if (!cleaned.success) {
    const issues = cleaned.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`${CONFIG_FILENAME} wouldn't be valid once its obsolete settings are removed:\n${issues}`);
  }
  const planned = { ...ctx, config: cleaned.data };
  const plans: MigrationPlan[] = [];
  for (const migration of MIGRATIONS) plans.push(await migration.plan(planned));
  return plans;
}

export const hasChanges = (plans: MigrationPlan[]) => plans.some((p) => p.changes.length > 0);
export const hasSkips = (plans: MigrationPlan[]) => plans.some((p) => p.skipped.length > 0);

/**
 * Applies every planned change in order and stops at the first failure, reporting what
 * had already been done so a partial upgrade is never mistaken for a complete one.
 */
export async function applyUpgrade(
  plans: MigrationPlan[],
  onDone: (plan: MigrationPlan, change: Change) => void,
): Promise<void> {
  const done: string[] = [];
  for (const plan of plans) {
    for (const change of plan.changes) {
      try {
        await change.apply();
      } catch (e) {
        throw new Error(
          `Upgrade stopped at "${change.summary}": ${(e as Error).message}\n` +
            (done.length ? `Already applied:\n${done.map((d) => `  - ${d}`).join("\n")}` : "Nothing was applied."),
        );
      }
      done.push(change.summary);
      onDone(plan, change);
    }
  }
}
