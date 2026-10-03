/**
 * `litecode uninstall`: removes the kit from a project (ADR 0026). Safety is the point:
 * the only candidates are paths a lockfile lists, and a listed path is accepted only when it
 * lies inside a directory litecode itself writes to (the allow-list), resolves inside the
 * project, is a regular file (a symlink is only ever unlinked, never followed) and is
 * unchanged since generated unless `--force`. Nothing outside the project, no branch and no
 * worktree is ever touched. Planning writes nothing; `applyUninstall` runs the plan.
 * Path containment, the "unchanged since generated" delete and empty-directory cleanup
 * are the helpers `upgrade` already uses for the same job.
 */

import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { CONFIG_FILENAME, TARGETS, TARGET_ROOTS } from "./config.ts";
import { agentTraces } from "./doctor.ts";
import { HOOK_LOCK_PATH, HOOK_REL, SKILL_ROOTS, lockPath } from "./install.ts";
import { hash, readLockfile, writeLockfile, type LockEntry, type Lockfile } from "./lockfile.ts";
import { deleteIfUnchanged, insideProject, removeIfEmpty } from "./project-upgrade.ts";

export type UninstallOptions = { force: boolean; config: boolean; ticketsDir?: string; outDir?: string };

type Removal = { rel: string; path: string; expected: string; edited: boolean };
/** A file left in place. `failed` marks the ones the user asked to remove but that could not be. */
type Keep = { rel: string; reason: string; failed?: boolean };
type LockPlan = { name: string; lock: Lockfile; remaining: Lockfile["files"] };

export type UninstallPlan = {
  /** False when no lockfile exists at all: nothing was ever installed. */
  found: boolean;
  /** Lockfiles that exist but cannot be parsed: when any, nothing is removed. */
  unreadable: { rel: string; reason: string }[];
  remove: Removal[];
  keep: Keep[];
  locks: LockPlan[];
  /** Lockfiles that go because nothing they list stays. */
  removeLocks: string[];
  /** Directories left empty by the removals, deepest first. */
  dirs: string[];
  hooksPath: { unset: boolean; note?: string };
  removeConfig: boolean;
  configPath: string;
};

export const UNINSTALL_USAGE = "Usage: litecode uninstall [--apply] [--force] [--config]";

/** Only the known options are accepted; a typo must never degrade into a harmless-looking preview. */
export function parseUninstallArgs(args: string[]): { apply: boolean; force: boolean; config: boolean } | { unknown: string[] } {
  const known = new Set(["--apply", "--force", "--config"]);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") i++; // the global option; its value is read before dispatch
    else if (!known.has(a)) unknown.push(a);
  }
  if (unknown.length > 0) return { unknown };
  return { apply: args.includes("--apply"), force: args.includes("--force"), config: args.includes("--config") };
}

/** Directories uninstall never removes from, whatever a (possibly tampered) lockfile says. */
const PROTECTED = ["docs/tickets", "docs/decisions"];

const REFUSED_OUTSIDE_ROOTS = "outside the directories litecode writes to";

const posixRel = (root: string, path: string) => relative(root, path).split(sep).join("/");

const isUnder = (rel: string, dirs: string[]) => dirs.some((d) => rel === d || rel.startsWith(`${d}/`));

/**
 * The allow-list: the only places a lockfile entry may point to. Each tool's own directory
 * and skills directory (from the install tables) plus the configured `outDir`; the git
 * hook is accepted solely through litecode's hook lock, as exactly `.githooks/pre-commit`.
 */
function writableRoots(root: string, outDir?: string): string[] {
  const roots = TARGETS.flatMap((t) => [TARGET_ROOTS[t], SKILL_ROOTS[t]]);
  const out = outDir ? posixRel(root, resolve(root, outDir)) : "";
  if (out && out !== ".." && !out.startsWith("../")) roots.push(out);
  return [...new Set(roots)];
}

function isAllowed(lockName: string, rel: string, roots: string[]): boolean {
  return lockName === HOOK_LOCK_PATH ? rel === HOOK_REL : isUnder(rel, roots);
}

async function git(root: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out.trim() : "";
}

const lstatOrNull = (path: string) => lstat(path).catch(() => null);

const errorCode = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;

type Verdict = { remove: Removal } | { keep: Keep } | "gone";

/** Decides what happens to one lockfile entry. Never throws: a file that cannot be inspected is kept. */
async function classifyEntry(
  root: string,
  lockName: string,
  rel: string,
  entry: LockEntry,
  ctx: { opts: UninstallOptions; roots: string[]; protectedDirs: string[]; lockNames: string[] },
): Promise<Verdict> {
  const keep = (reason: string, failed = false): Verdict => ({ keep: { rel, reason, ...(failed ? { failed } : {}) } });
  const path = await insideProject(root, rel);
  if (!path) return keep("points outside the project; uninstall never deletes there");
  const projectRel = posixRel(root, path);
  if (!isAllowed(lockName, projectRel, ctx.roots) || ctx.lockNames.includes(projectRel)) {
    return keep(`${REFUSED_OUTSIDE_ROOTS}; never removed`);
  }
  if (isUnder(projectRel, ctx.protectedDirs)) return keep("tickets and decisions are never removed");

  const stat = await lstatOrNull(path);
  if (!stat) return "gone";
  // A symlink is never followed: `--force` unlinks the link itself, whatever it points at.
  if (stat.isSymbolicLink()) {
    return ctx.opts.force ? { remove: { rel, path, expected: "", edited: true } } : keep("not a regular file (a symlink); pass --force to unlink it");
  }
  if (!stat.isFile()) return keep("not a regular file");

  let current: string;
  try {
    current = hash(await Bun.file(path).text());
  } catch (e) {
    return keep(`cannot be read: ${errorCode(e)}`, true);
  }
  if (current === entry.hash) return { remove: { rel, path, expected: entry.hash, edited: false } };
  // The hook special case: a hook that no longer matches its lock is the user's now, even with --force.
  if (lockName === HOOK_LOCK_PATH && rel === HOOK_REL) {
    return keep("hook edited since it was generated; a hook is never removed unless it matches its lock");
  }
  if (ctx.opts.force) return { remove: { rel, path, expected: current, edited: true } };
  return keep("edited since it was generated; pass --force to remove it");
}

/** Directories left empty by the removals, found bottom-up so a parent counts once its children are gone. */
async function emptiedDirs(root: string, gone: Set<string>): Promise<string[]> {
  const candidates = new Set<string>();
  for (const p of gone) {
    for (let d = dirname(p); d !== root && !relative(root, d).startsWith(".."); d = dirname(d)) candidates.add(d);
  }
  const dirs: string[] = [];
  for (const dir of [...candidates].sort((a, b) => b.split(sep).length - a.split(sep).length)) {
    if (!(await lstatOrNull(dir))?.isDirectory()) continue;
    const entries = await readdir(dir);
    if (entries.every((e) => gone.has(resolve(dir, e)))) {
      gone.add(dir);
      dirs.push(dir);
    }
  }
  return dirs;
}

export async function planUninstall(root: string, opts: UninstallOptions): Promise<UninstallPlan> {
  const lockNames = [...TARGETS.map(lockPath), HOOK_LOCK_PATH];
  const ctx = {
    opts,
    roots: writableRoots(root, opts.outDir),
    protectedDirs: [...PROTECTED, ...(opts.ticketsDir ? [posixRel(root, resolve(root, opts.ticketsDir))] : [])],
    lockNames,
  };
  const remove: Removal[] = [];
  const keep: Keep[] = [];
  const locks: LockPlan[] = [];
  const unreadable: UninstallPlan["unreadable"] = [];
  let hookLockFound = false;
  let hookKept = false;

  for (const name of lockNames) {
    let lock: Lockfile | null;
    try {
      lock = await readLockfile(root, name);
      if (lock && (typeof lock.files !== "object" || lock.files === null)) throw new Error("no 'files' table");
    } catch (e) {
      unreadable.push({ rel: name, reason: (e as Error).message });
      continue;
    }
    if (!lock) continue;
    const isHookLock = name === HOOK_LOCK_PATH;
    if (isHookLock) hookLockFound = true;
    const remaining: Lockfile["files"] = {};
    for (const [rel, entry] of Object.entries(lock.files)) {
      const verdict = await classifyEntry(root, name, rel, entry, ctx);
      if (verdict === "gone") continue;
      if ("remove" in verdict) {
        remove.push(verdict.remove);
        continue;
      }
      keep.push(verdict.keep);
      remaining[rel] = entry;
      if (isHookLock) hookKept = true;
    }
    locks.push({ name, lock, remaining });
  }

  const found = locks.length > 0;
  const removeLocks = locks.filter((l) => Object.keys(l.remaining).length === 0).map((l) => l.name);
  const gone = new Set([...remove.map((r) => r.path), ...removeLocks.map((n) => resolve(root, n))]);
  const dirs = await emptiedDirs(root, gone);
  const hooksPath = await planHooksPath(root, { hookLockFound, hookKept, gone });
  const configPath = resolve(root, CONFIG_FILENAME);
  const removeConfig = found && opts.config && (await lstatOrNull(configPath)) !== null;
  return { found, unreadable, remove, keep, locks, removeLocks, dirs, hooksPath, removeConfig, configPath };
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
  for (const name of plan.removeLocks) lines.push(`  ${name}  (lockfile)`);
  for (const d of plan.dirs) lines.push(`  ${rel(d)}/  (empty directory)`);
  if (plan.hooksPath.unset) lines.push("  core.hooksPath  (reset to unset: litecode set it to .githooks)");
  if (plan.removeConfig) lines.push(`  ${CONFIG_FILENAME}  (--config)`);
  const failed = plan.keep.filter((k) => k.failed);
  if (applied && failed.length > 0) {
    lines.push("", "Failed:");
    for (const k of failed) lines.push(`  ${k.rel}: ${k.reason}`);
  }
  lines.push("", "Kept:");
  for (const k of plan.keep) if (!applied || !k.failed) lines.push(`  ${k.rel}: ${k.reason}`);
  if (plan.hooksPath.note) lines.push(`  ${plan.hooksPath.note}`);
  if (!plan.removeConfig) lines.push(`  ${CONFIG_FILENAME}: pass --config to remove it too`);
  lines.push("  docs/tickets/, docs/decisions/, your own files, branches and worktrees: never removed");
  return lines;
}

/** Runs the plan. What could not be removed comes back as `keep` entries flagged `failed`. */
export async function applyUninstall(root: string, plan: UninstallPlan): Promise<UninstallPlan> {
  const done: Removal[] = [];
  const keep = [...plan.keep];
  const failedRels = new Set<string>();
  const fail = (rel: string, e: unknown) => {
    failedRels.add(rel);
    keep.push({ rel, reason: `could not be removed: ${(e as Error).message}`, failed: true });
  };
  for (const r of plan.remove) {
    try {
      if (r.edited) await rm(r.path);
      else await deleteIfUnchanged(r.path, r.expected, r.rel);
      done.push(r);
    } catch (e) {
      fail(r.rel, e);
    }
  }
  const removedLocks: string[] = [];
  for (const l of plan.locks) {
    // A lockfile keeps vouching for what is still there, including what failed to go.
    const remaining = { ...l.remaining };
    for (const rel of failedRels) if (l.lock.files[rel]) remaining[rel] = l.lock.files[rel]!;
    try {
      if (Object.keys(remaining).length === 0) {
        await rm(resolve(root, l.name), { force: true });
        removedLocks.push(l.name);
      } else {
        await writeLockfile(root, { ...l.lock, files: remaining }, l.name);
      }
    } catch (e) {
      fail(l.name, e);
    }
  }
  for (const d of plan.dirs) await removeIfEmpty(d);
  if (plan.hooksPath.unset) await git(root, ["config", "--unset", "core.hooksPath"]);
  if (plan.removeConfig) await rm(plan.configPath, { force: true });
  return { ...plan, remove: done, keep, removeLocks: removedLocks };
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
