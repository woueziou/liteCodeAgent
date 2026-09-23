/**
 * `litecode upgrade`, for a project: everything an existing install needs after a new
 * release, in one command (ADR 0016). Each migration inspects the project and proposes
 * only the changes it actually needs, so a project that is already current gets an empty
 * plan and re-running the command is harmless. A future breaking release adds its own
 * migration to `MIGRATIONS` rather than asking users for another manual step.
 *
 * Planning never writes anything; `applyUpgrade` runs the planned changes in order. The
 * CLI shows the plan and asks before applying it.
 */

import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG_FILENAME, ConfigSchema, TARGETS, type Config } from "./config.ts";
import { applyPlan, buildPlan, lockPath } from "./install.ts";
import { hash, readLockfile } from "./lockfile.ts";
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

/** Re-renders every installed agent, skill and command for the configured tools. */
const renderPacks: Migration = {
  id: "packs",
  title: "Re-render installed agents and skills",
  async plan(ctx) {
    const plan = await buildPlan(ctx.root, ctx.packsRoot, ctx.config);
    const drifted = plan.entries.filter((e) => e.status === "drift");
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
              "Move those edits upstream into the pack, or run `litecode install --apply --force` to discard them.",
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

/**
 * Removes files an earlier version generated and this one no longer produces (the `sync`
 * agent's copies, say) — but only when they still match the hash their lockfile recorded.
 * A file someone edited since is kept: deleting it would lose their work.
 */
const removeOrphans: Migration = {
  id: "orphans",
  title: "Remove files earlier versions generated",
  async plan(ctx) {
    const plan = await buildPlan(ctx.root, ctx.packsRoot, ctx.config);
    const recorded = new Map<string, string>();
    for (const target of TARGETS) {
      const lock = await readLockfile(ctx.root, lockPath(target));
      for (const [rel, entry] of Object.entries(lock?.files ?? {})) recorded.set(rel, entry.hash);
    }
    const changes: Change[] = [];
    const skipped: Skip[] = [];
    for (const rel of plan.orphans) {
      const path = resolve(ctx.root, rel);
      if (!(await exists(path))) continue;
      if (hash(await Bun.file(path).text()) === recorded.get(rel)) {
        changes.push({ summary: `delete ${rel}`, apply: () => rm(path) });
      } else {
        skipped.push({ summary: `keep ${rel}`, reason: "edited since it was generated; delete it yourself if you don't need it" });
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
    const { tickets } = await listTicketsDetailed(ctx.root, ctx.config.project.tickets.dir);
    const changes: Change[] = [];
    const skipped: Skip[] = [];
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

/** Config keys nothing reads any more, as paths under the config file's root object. */
const OBSOLETE_CONFIG_KEYS = [
  ["project", "tickets", "autoStateFile"],
  ["project", "tickets", "autoMinIntervalMs"],
  ["project", "agentSkills", "sync"],
  ["project", "board"],
] as const;

/**
 * Skills earlier packs shipped and this one doesn't. A config still naming one keeps
 * rendering it into agents' frontmatter, and install only accepts it because the old
 * installed copy passes for a local overlay — until that orphan is deleted.
 */
const REMOVED_SKILLS = new Set(["github-project-sync"]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parent object holding `path`'s last key, when the whole path exists. */
function parentOf(raw: Json, path: readonly string[]): Json | undefined {
  let node: unknown = raw;
  for (const key of path.slice(0, -1)) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return isObject(node) && path.at(-1)! in node ? node : undefined;
}

/** Every skill list in the config: agentSkills values, and each angle's and domain's skills. */
function skillLists(raw: Json): { where: string; list: unknown[] }[] {
  const project = isObject(raw.project) ? raw.project : {};
  const lists: { where: string; list: unknown[] }[] = [];
  if (isObject(project.agentSkills)) {
    for (const [agent, list] of Object.entries(project.agentSkills)) {
      if (Array.isArray(list)) lists.push({ where: `project.agentSkills.${agent}`, list });
    }
  }
  for (const group of ["angles", "domains"] as const) {
    const entries = project[group];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, i) => {
      if (isObject(entry) && Array.isArray(entry.skills)) lists.push({ where: `project.${group}[${i}].skills`, list: entry.skills });
    });
  }
  return lists;
}

/** What `cleanConfig` would remove from a raw config, as human-readable paths. */
function obsoleteConfig(raw: Json): string[] {
  const found = OBSOLETE_CONFIG_KEYS.filter((path) => parentOf(raw, path)).map((path) => path.join("."));
  // Skill lists under a key that is itself going away aren't worth listing twice.
  const survivors = structuredClone(raw);
  for (const path of OBSOLETE_CONFIG_KEYS) delete parentOf(survivors, path)?.[path.at(-1)!];
  for (const { where, list } of skillLists(survivors)) {
    for (const skill of list) if (typeof skill === "string" && REMOVED_SKILLS.has(skill)) found.push(`${skill} from ${where}`);
  }
  return found;
}

/** A copy of the raw config with every obsolete key and removed skill taken out. */
export function cleanedConfig(raw: Json): Json {
  const copy = structuredClone(raw);
  for (const path of OBSOLETE_CONFIG_KEYS) delete parentOf(copy, path)?.[path.at(-1)!];
  for (const { list } of skillLists(copy)) {
    for (let i = list.length - 1; i >= 0; i--) if (REMOVED_SKILLS.has(list[i] as string)) list.splice(i, 1);
  }
  return copy;
}

async function readRawConfig(root: string): Promise<Json> {
  return (await Bun.file(resolve(root, CONFIG_FILENAME)).json()) as Json;
}

/**
 * Removes obsolete keys and skill names from the config file as written — not from the
 * parsed config, which would also write out every default the user never set.
 */
const cleanConfig: Migration = {
  id: "config",
  title: `Remove obsolete settings from ${CONFIG_FILENAME}`,
  async plan(ctx) {
    const raw = await readRawConfig(ctx.root);
    const found = obsoleteConfig(raw);
    const changes: Change[] =
      found.length === 0
        ? []
        : [
            {
              summary: `remove ${found.length} obsolete setting(s)`,
              details: found,
              async apply() {
                await Bun.write(resolve(ctx.root, CONFIG_FILENAME), `${JSON.stringify(cleanedConfig(raw), null, 2)}\n`);
              },
            },
          ];
    return { id: this.id, title: this.title, changes, skipped: [] };
  },
};

/**
 * Data files the board commands and the ticket sync wrote, at the paths the config named
 * for them (read before `cleanConfig` removes those keys) or their defaults.
 */
const removeLegacyData: Migration = {
  id: "legacy-data",
  title: "Delete data files of removed features",
  async plan(ctx) {
    const raw = await readRawConfig(ctx.root);
    const project = isObject(raw.project) ? raw.project : {};
    const board = isObject(project.board) ? project.board : {};
    const tickets = isObject(project.tickets) ? project.tickets : {};
    const str = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback);
    const candidates = [
      str(board.dataFile, ".claude/data/board.json"),
      str(board.itemIdCache, ".claude/data/github-project-item-ids.json"),
      str(tickets.autoStateFile, ".claude/data/ticket-sync-auto-state.json"),
    ];
    const changes: Change[] = [];
    for (const rel of [...new Set(candidates)]) {
      const path = resolve(ctx.root, rel);
      if (await exists(path)) changes.push({ summary: `delete ${rel}`, apply: () => rm(path) });
    }
    return { id: this.id, title: this.title, changes, skipped: [] };
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
  const config = ConfigSchema.parse(cleanedConfig(await readRawConfig(ctx.root)));
  const planned = { ...ctx, config };
  const plans: MigrationPlan[] = [];
  for (const migration of MIGRATIONS) plans.push(await migration.plan(planned));
  return plans;
}

export const hasChanges = (plans: MigrationPlan[]) => plans.some((p) => p.changes.length > 0);

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
