/** Thin `gh` wrapper. All GitHub access goes through the user's existing gh auth. */

export class GhError extends Error {}

async function run(args: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], {
    stdin: input ? new TextEncoder().encode(input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new GhError(`gh ${args.join(" ")} failed (exit ${code}):\n${stderr.trim()}`);
  return stdout;
}

export async function graphql<T>(query: string, vars: Record<string, string | number>): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) {
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  }
  const out = await run(args);
  const parsed = JSON.parse(out) as { data?: T; errors?: { message: string }[] };
  if (parsed.errors?.length) {
    throw new GhError(`GraphQL error: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  if (!parsed.data) throw new GhError("GraphQL returned no data");
  return parsed.data;
}

export async function gh(args: string[]): Promise<string> {
  return run(args);
}

export async function ensureAuth(): Promise<void> {
  try {
    await run(["auth", "status"]);
  } catch (e) {
    throw new GhError(
      `gh is not authenticated. Run \`gh auth login\` first.\n${(e as Error).message}`,
    );
  }
}
