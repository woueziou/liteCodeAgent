import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Records exactly which files in the target repo belong to LiteCodeAgent, and at what version.
 *
 * This is what makes "local overlay" safe: anything in `.claude/` that is NOT in the
 * lockfile is the project's own and is never read, rewritten, or removed by the CLI.
 */

export const LOCKFILE_NAME = ".claude/.litecode-lock.json";

export type LockEntry = {
  pack: string;
  version: string;
  /** sha256 of the rendered content we wrote, so drift (hand edits) is detectable. */
  hash: string;
};

export type Lockfile = {
  litecodeVersion: string;
  installedAt: string;
  packs: Record<string, string>;
  files: Record<string, LockEntry>;
};

export async function readLockfile(projectRoot: string): Promise<Lockfile | null> {
  const file = Bun.file(resolve(projectRoot, LOCKFILE_NAME));
  if (!(await file.exists())) return null;
  return (await file.json()) as Lockfile;
}

export async function writeLockfile(projectRoot: string, lock: Lockfile): Promise<void> {
  const path = resolve(projectRoot, LOCKFILE_NAME);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(lock, null, 2)}\n`);
}

export function hash(content: string): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 16);
}
