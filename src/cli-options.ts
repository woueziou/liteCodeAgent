/**
 * Strict option checking for commands that change files.
 *
 * Most commands read their options with `argv.includes("--flag")`, which silently ignores a
 * typo: `--yez` runs as if it had not been given. That is harmless for a read-only command
 * and dangerous for one that applies changes or skips a safety step. A command opts in by
 * calling this with the options it knows, and failing on whatever comes back.
 */

/**
 * The arguments of `args` that the command does not know: unknown `-`/`--` options, and stray
 * positional words. `valued` options take the next argument as their value (`--project <dir>`),
 * which is not reported. `args` is the argument list after the command word.
 */
export function unknownArguments(args: readonly string[], known: readonly string[], valued: readonly string[] = []): string[] {
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valued.includes(a)) {
      i++; // its value
      continue;
    }
    if (known.includes(a)) continue;
    unknown.push(a);
  }
  return unknown;
}
