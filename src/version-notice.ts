import { readLockfile } from "./lockfile.ts";

const LOCKFILES = [
  ".claude/.litecode-lock.json",
  ".codex/.litecode-lock.json",
  ".pi/.litecode-lock.json",
  ".opencode/.litecode-lock.json",
  ".kilo/.litecode-lock.json",
];

/** Numeric `major.minor.patch` comparison; a pre-release suffix is ignored. */
function isOlder(installed: string, running: string): boolean {
  const parse = (v: string) => v.split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(installed);
  const b = parse(running);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

/**
 * The oldest release that rendered this project's files, when it is older than the running
 * one; null when the project is current or has no install yet.
 */
export async function projectBehind(root: string, running: string): Promise<string | null> {
  let oldest: string | null = null;
  for (const path of LOCKFILES) {
    const lock = await readLockfile(root, path);
    if (!lock) continue;
    if (isOlder(lock.litecodeVersion, running) && (oldest === null || isOlder(lock.litecodeVersion, oldest))) {
      oldest = lock.litecodeVersion;
    }
  }
  return oldest;
}
