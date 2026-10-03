/**
 * `litecode uninstall`: removes the kit from a project (ADR 0026). Safety is the point:
 * the only candidates are paths a lockfile lists, each must resolve inside the project, an
 * edited file is kept unless `--force`, and nothing outside the project, no branch and no
 * worktree is ever touched. Planning writes nothing; `applyUninstall` runs the plan.
 * Path containment, the "unchanged since generated" delete and empty-directory cleanup
 * are the helpers `upgrade` already uses for the same job.
 */

import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { CONFIG_FILENAME, TARGETS } from "./config.ts";
import { agentTraces } from "./doctor.ts";
import { HOOK_LOCK_PATH, HOOK_REL, lockPath } from "./install.ts";
import { hash, readLockfile, writeLockfile, type Lockfile } from "./lockfile.ts";
import { deleteIfUnchanged, insideProject, removeIfEmpty } from "./project-upgrade.ts";

export type UninstallOptions = { force: boolean; config: boolean; ticketsDir?: string };

type Removal = { rel: string; path: string; expected: string; edited: boolean };
type Keep = { rel: string; reason: string };
type LockPlan = { name: string; lock: Lockfile; remaining: Lockfile["files"] };

export type UninstallPlan = {
  /** False when no lockfile exists at all: nothing was ever installed. */
  found: boolean;
  remove: Removal[];
  keep: Keep[];
  locks: LockPlan[];
  /** Directories left empty by the removals, deepest first. */
  dirs: string[];
  hooksPath: { unset: boolean; note?: string };
  removeConfig: boolean;
  configPath: string;
};

/** Directories uninstall never removes from, whatever a (possibly tampered) lockfile says. */
const PROTECTED = ["docs/tickets", "docs/decisions"];

function isProtected(root: string, path: string, extra: string[]): boolean {
  const rel = relative(root, path).split(sep).join("/");
  return [...PROTECTED, ...extra].some((p) => rel === p || rel.startsWith(`${p}/`));
}

async function git(root: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : "";
}

const lstatOrNull = (path: string) => lstat(path).catch(() => null);

export async function planUninstall(root: string, opts: UninstallOptions): Promise<UninstallPlan> {
  const extraProtected = opts.ticketsDir ? [relative(root, resolve(root, opts.ticketsDir)).split(sep).join("/")] : [];
  const lockNames = [...TARGETS.map(lockPath), HOOK_LOCK_PATH];
  const remove: Removal[] = [];
  const keep: Keep[] = [];
  const locks: LockPlan[] = [];
  let hookLockFound = false;
  let hookKept = false;

  for (const name of lockNames) {
    let lock: Lockfile | null;
    try {
      lock = await readLockfile(root, name);
    } catch {
      keep.push({ rel: name, reason: "lockfile is not valid JSON; left in place, nothing it lists is a candidate" });
      continue;
    }
    if (!lock || typeof lock.files !== "object" || lock.files === null) continue;
    const isHookLock = name === HOOK_LOCK_PATH;
    if (isHookLock) hookLockFound = true;
    const remaining: Lockfile["files"] = {};
    for (const [rel, entry] of Object.entries(lock.files)) {
      const keepIt = (reason: string) => {
        keep.push({ rel, reason });
        remaining[rel] = entry;
        if (isHookLock) hookKept = true;
      };
      const path = await insideProject(root, rel);
      if (!path) {
        keepIt("points outside the project; uninstall never deletes there");
        continue;
      }
      if (isProtected(root, path, extraProtected)) {
        keepIt("tickets and decisions are never removed");
        continue;
      }
      const stat = await lstatOrNull(path);
      if (!stat) continue; // already gone
      if (stat.isDirectory()) {
        keepIt("is a directory, not a generated file");
        continue;
      }
      const current = hash(await Bun.file(path).text());
      if (current === entry.hash) {
        remove.push({ rel, path, expected: entry.hash, edited: false });
      } else if (opts.force && !(isHookLock && rel === HOOK_REL)) {
        remove.push({ rel, path, expected: current, edited: true });
      } else {
        keepIt(
          rel === HOOK_REL
            ? "hook edited since it was generated; a hook is never removed unless it matches its lock"
            : "edited since it was generated; pass --force to remove it",
        );
      }
    }
    locks.push({ name, lock, remaining });
  }

  const found = locks.length > 0;
  const removedSet = new Set(remove.map((r) => r.path));
  for (const l of locks) {
    if (Object.keys(l.remaining).length === 0) removedSet.add(resolve(root, l.name));
  }

  // Directories left empty by the removals, found bottom-up so a parent counts once its
  // children are gone. Never the project root, never a directory with anything else in it.
  const dirs: string[] = [];
  const candidates = new Set<string>();
  for (const p of removedSet) {
    for (let d = dirname(p); d !== root && !relative(root, d).startsWith(".."); d = dirname(d)) candidates.add(d);
  }
  const gone = new Set(removedSet);
  for (const dir of [...candidates].sort((a, b) => b.split(sep).length - a.split(sep).length)) {
    const stat = await lstatOrNull(dir);
    if (!stat?.isDirectory()) continue;
    const entries = await readdir(dir);
    if (entries.every((e) => gone.has(resolve(dir, e)))) {
      gone.add(dir);
      dirs.push(dir);
    }
  }

  const hooksPath = await planHooksPath(root, { hookLockFound, hookKept, gone });
  const configPath = resolve(root, CONFIG_FILENAME);
  const removeConfig = found && opts.config && (await lstatOrNull(configPath)) !== null;
  return { found, remove, keep, locks, dirs, hooksPath, removeConfig, configPath };
}

/**
 * `core.hooksPath` goes back to unset only when it is `.githooks` AND litecode's hook lock
 * exists: the lock is written by the install step that sets the path, so it is the only
 * record that litecode set it. It is also left alone when the hook was kept or other files
 * stay in `.githooks`, so the hooks that remain keep running.
 */
async function planHooksPath(
  root: string,
  s: { hookLockFound: boolean; hookKept: boolean; gone: Set<string> },
): Promise<{ unset: boolean; note?: string }> {
  const toplevel = await git(root, ["rev-parse", "--show-toplevel"]);
  const same = toplevel && (await realpath(toplevel).catch(() => toplevel)) === (await realpath(root).catch(() => root));
  if (!same) return { unset: false };
  const current = await git(root, ["config", "--get", "core.hooksPath"]);
  if (!current) return { unset: false };
  if (current !== ".githooks") {
    return { unset: false, note: `core.hooksPath is '${current}', not set by litecode: left as it is` };
  }
  if (!s.hookLockFound) {
    return { unset: false, note: "core.hooksPath is '.githooks' but litecode's hook lock is absent, so litecode did not set it: left as it is" };
  }
  if (s.hookKept) return { unset: false, note: "core.hooksPath stays '.githooks': the hook was kept, so it keeps running" };
  const hooksDir = resolve(root, ".githooks");
  const entries = await readdir(hooksDir).catch(() => [] as string[]);
  if (entries.some((e) => !s.gone.has(resolve(hooksDir, e)))) {
    return { unset: false, note: "core.hooksPath stays '.githooks': other files remain there and keep running" };
  }
  return { unset: true };
}

/** The preview (or the record of what was done), line by line. */
export function describePlan(root: string, plan: UninstallPlan, applied: boolean): string[] {
  const rel = (p: string) => relative(root, p) || ".";
  const lines: string[] = [];
  lines.push(applied ? "Removed:" : "Would remove:");
  for (const r of plan.remove) lines.push(`  ${r.rel}${r.edited ? "  (edited, removed because of --force)" : ""}`);
  for (const l of plan.locks) if (Object.keys(l.remaining).length === 0) lines.push(`  ${l.name}  (lockfile)`);
  for (const d of plan.dirs) lines.push(`  ${rel(d)}/  (empty directory)`);
  if (plan.hooksPath.unset) lines.push("  core.hooksPath  (reset to unset: litecode set it to .githooks)");
  if (plan.removeConfig) lines.push(`  ${CONFIG_FILENAME}  (--config)`);
  lines.push("", "Kept:");
  for (const k of plan.keep) lines.push(`  ${k.rel}: ${k.reason}`);
  if (plan.hooksPath.note) lines.push(`  ${plan.hooksPath.note}`);
  if (!plan.removeConfig) lines.push(`  ${CONFIG_FILENAME}: pass --config to remove it too`);
  lines.push("  docs/tickets/, docs/decisions/, your own files, branches and worktrees: never removed");
  return lines;
}

export async function applyUninstall(root: string, plan: UninstallPlan): Promise<UninstallPlan> {
  const done: Removal[] = [];
  const keep = [...plan.keep];
  for (const r of plan.remove) {
    try {
      if (r.edited) await rm(r.path);
      else await deleteIfUnchanged(r.path, r.expected, r.rel);
      done.push(r);
    } catch (e) {
      keep.push({ rel: r.rel, reason: (e as Error).message });
    }
  }
  const failed = new Set(keep.map((k) => k.rel));
  for (const l of plan.locks) {
    const remaining = { ...l.remaining };
    for (const r of plan.remove) if (failed.has(r.rel) && l.lock.files[r.rel]) remaining[r.rel] = l.lock.files[r.rel]!;
    if (Object.keys(remaining).length === 0) await rm(resolve(root, l.name), { force: true });
    else await writeLockfile(root, { ...l.lock, files: remaining }, l.name);
  }
  for (const d of plan.dirs) await removeIfEmpty(d);
  if (plan.hooksPath.unset) await git(root, ["config", "--unset", "core.hooksPath"]);
  if (plan.removeConfig) await rm(plan.configPath, { force: true });
  return { ...plan, remove: done, keep };
}

/** What lives outside the project, and what agents left in the repo, with the commands to clear them. */
export async function outsideNotice(root: string, worktreeRoot: string): Promise<string[]> {
  const lines = [
    "Outside this project (litecode did not touch these):",
    "  Claude Code plugin:        /plugin uninstall litecode-agent@litecode",
    "  clone made by install.sh:  rm -rf ~/.litecode",
  ];
  const { branches, worktrees } = await agentTraces(root, worktreeRoot);
  if (branches.length > 0 || worktrees.length > 0) {
    lines.push("", "Agent branches and worktrees still in this repo (not removed):");
    for (const w of worktrees) lines.push(`  git worktree remove ${w}`);
    for (const b of branches) lines.push(`  git branch -D ${b}    # and, if it was pushed: git push origin --delete ${b}`);
  }
  return lines;
}
