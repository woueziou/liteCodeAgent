/** Thin `gh` wrapper. All GitHub access goes through the user's existing gh auth. */

export class GhError extends Error {}

/**
 * GitHub answers "rate limit" for two very different situations, and they need opposite
 * handling:
 *
 *  - the PRIMARY hourly quota (5000 points) is exhausted — retrying is pointless, the
 *    caller has to wait for the documented reset;
 *  - a SECONDARY limit (burst/abuse throttle, keyed on the user id) tripped — the hourly
 *    counter still reads full, and the block lifts on its own within seconds to minutes.
 *
 * The second is what board commands actually hit, and it is indistinguishable from the
 * first by message alone. So a failed call asks `gh api rate_limit` (which is itself
 * exempt from the quota): a full remaining count means a secondary limit, which is worth
 * retrying; a drained one means waiting until the reset, which is reported rather than
 * slept through.
 */
export class RateLimitError extends GhError {
  constructor(message: string, readonly resetAt: Date | null) {
    super(message);
  }
}


/** Retrying past this point is just a slow failure — report the reset instead. */
const MAX_WAIT_MS = 120_000;

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /secondary rate limit/i,
  /abuse detection/i,
  /RATE_LIMITED/,
];

function looksRateLimited(stderr: string): boolean {
  return RATE_LIMIT_PATTERNS.some((p) => p.test(stderr));
}

/** Keeps the multi-line GraphQL document out of user-facing errors. */
function summarize(args: string[]): string {
  return args.map((a) => (a.startsWith("query=") || a.startsWith("mutation=") ? "query=…" : a)).join(" ");
}

/** Overridable so a non-standard gh install (and the test stubs) can be pointed at. */
function ghBin(): string {
  return process.env.LITECODE_GH_BIN || "gh";
}

async function spawnGh(args: string[], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([ghBin(), ...args], {
    env: process.env,
    stdin: input ? new TextEncoder().encode(input) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

type Quota = { remaining: number; resetAt: Date | null };

/** `rate_limit` does not itself consume quota, so it is safe to call on every failure. */
async function readQuota(): Promise<Quota | null> {
  const { stdout, code } = await spawnGh(["api", "rate_limit"]);
  if (code !== 0) return null;
  try {
    const parsed = JSON.parse(stdout) as {
      resources?: { graphql?: { remaining: number; reset: number } };
    };
    const g = parsed.resources?.graphql;
    if (!g) return null;
    return { remaining: g.remaining, resetAt: new Date(g.reset * 1000) };
  } catch {
    return null;
  }
}

// Read per call, not at import: tests (and a user exporting the var mid-session) need the
// knobs to take effect without reloading the module.
function maxAttempts(): number {
  return Number(process.env.LITECODE_GH_RETRIES ?? 5);
}

function backoffMs(attempt: number): number {
  const unit = Number(process.env.LITECODE_GH_BACKOFF_MS ?? 2000);
  const base = Math.min(unit * 2 ** (attempt - 1), 30_000);
  return base + Math.floor(Math.random() * (unit / 2)); // jitter, so parallel agents don't resync
}

export type RunOptions = {
  /** Called before each wait, so the CLI can tell the user why it is pausing. */
  onRetry?: (attempt: number, waitMs: number, reason: string) => void;
};

let notify: RunOptions["onRetry"];

/** Lets the CLI surface retry notices without threading options through every call site. */
export function onGhRetry(fn: RunOptions["onRetry"]): void {
  notify = fn;
}

async function run(args: string[], input?: string): Promise<string> {
  let waited = 0;

  for (let attempt = 1; ; attempt++) {
    const { stdout, stderr, code } = await spawnGh(args, input);
    if (code === 0) return stdout;

    if (!looksRateLimited(stderr)) {
      throw new GhError(`gh ${summarize(args)} failed (exit ${code}):\n${stderr.trim()}`);
    }

    const quota = await readQuota();
    const resetAt = quota?.resetAt ?? null;

    // Primary quota genuinely drained: the wait is measured in tens of minutes, so tell
    // the user when to come back instead of burning attempts against a closed door.
    if (quota && quota.remaining === 0) {
      throw new RateLimitError(
        `GitHub's GraphQL hourly quota is exhausted.${
          resetAt ? ` It resets at ${resetAt.toLocaleTimeString()}.` : ""
        }\nRe-run this command after the reset, or use a token with its own quota ` +
          `(a GitHub App installation token) via GH_TOKEN.`,
        resetAt,
      );
    }

    const wait = backoffMs(attempt);
    if (attempt >= maxAttempts() || waited + wait > MAX_WAIT_MS) {
      throw new RateLimitError(
        `GitHub rejected ${attempt} attempt(s) with a secondary rate limit ` +
          `(the hourly quota is not exhausted — this is a burst throttle on your account).\n` +
          `Wait a few minutes and re-run, or use a GitHub App installation token via GH_TOKEN, ` +
          `which carries its own limit.`,
        resetAt,
      );
    }

    notify?.(attempt, wait, "GitHub secondary rate limit");
    waited += wait;
    await Bun.sleep(wait);
  }
}

export async function graphql<T>(query: string, vars: Record<string, string | number>): Promise<T> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) {
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  }
  const out = await run(args);
  const parsed = JSON.parse(out) as { data?: T; errors?: { message: string; type?: string }[] };
  if (parsed.errors?.length) {
    // A 200 response can still carry RATE_LIMITED in the error body.
    if (parsed.errors.some((e) => e.type === "RATE_LIMITED" || looksRateLimited(e.message))) {
      throw new RateLimitError(
        `GitHub rate-limited this query: ${parsed.errors.map((e) => e.message).join("; ")}`,
        null,
      );
    }
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
    if (e instanceof RateLimitError) throw e;
    throw new GhError(
      `gh is not authenticated. Run \`gh auth login\` first.\n${(e as Error).message}`,
    );
  }
}
