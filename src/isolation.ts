import { rm } from "node:fs/promises";
import { join } from "node:path";
import { WORKTREE_SUPPORT, type InstallTarget, type Project } from "./config.ts";

/** Isolation mode of `implementer` (ADR 0023). */
export type IsolationSetting = "auto" | "worktree" | "inline";
export type IsolationMode = "worktree" | "inline";
export type IsolationTarget = InstallTarget | "runner";

/**
 * The call's mode wins over the project's; `auto` reads the capability table, with the
 * project's `worktreeSupport` overriding it. Ticket size is deliberately not an input.
 */
export function resolveIsolationMode(
  project: Pick<Project, "isolation" | "worktreeSupport">,
  target: IsolationTarget,
  call?: IsolationSetting,
): IsolationMode {
  const setting = call && call !== "auto" ? call : project.isolation;
  if (setting !== "auto") return setting;
  const supported = project.worktreeSupport[target] ?? WORKTREE_SUPPORT[target];
  return supported ? "worktree" : "inline";
}

/** Why inline cannot start, or `null` when it can. */
export type InlineRefusal = string | null;

async function git(root: string, ...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function lockPath(root: string): Promise<string> {
  const dir = (await git(root, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim();
  return join(dir, "litecode-implementer.lock");
}

type Lock = { ticket: string; pid: number };

/** The live lock, or null when none exists or its process is gone (stale). */
async function readLock(path: string): Promise<Lock | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const lock = (await file.json()) as Lock;
    return alive(lock.pid) ? lock : null;
  } catch {
    return null;
  }
}

/**
 * Takes the single-implementer lock for an inline run, or says why not (ADR 0023): the
 * working tree must be clean, and no other live implementer may hold the lock. `pid` is the
 * long-lived process the lock lives and dies with (the agent's shell, not this short CLI call).
 */
export async function startInline(root: string, ticket: string, pid: number): Promise<InlineRefusal> {
  if ((await git(root, "status", "--porcelain")).trim()) {
    return "inline refused: the working tree is dirty (commit, stash or discard unrelated changes first)";
  }
  const path = await lockPath(root);
  const held = await readLock(path);
  if (held && held.ticket !== ticket) {
    return `inline refused: another implementer is already running (ticket ${held.ticket}, pid ${held.pid})`;
  }
  await Bun.write(path, JSON.stringify({ ticket, pid }));
  return null;
}

/** Releases the lock held for `ticket`; a lock held for another ticket is left alone. */
export async function endInline(root: string, ticket: string): Promise<void> {
  const path = await lockPath(root);
  const lock = await readLock(path);
  if (lock && lock.ticket !== ticket) return;
  await rm(path, { force: true });
}
