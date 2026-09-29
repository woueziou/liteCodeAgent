/**
 * Thin `gh` wrapper, with rate-limit handling. All GitHub access goes through the user's
 * existing gh auth. Since tickets became purely local (ADR 0015), the CLI's only call is
 * `verify-report`'s read-only `gh pr view`; agents run their own `gh pr` commands.
 */

export class GhError extends Error {
  /**
   * What the failed call printed on stdout. Some `gh` commands exit non-zero while still
   * printing the data asked for (`gh pr checks --json` exits 1 on a failing check and 8 on a
   * pending one), so callers that know this can still read it.
   */
  constructor(message: string, readonly stdout: string = "", readonly exitCode: number | null = null) {
    super(message);
  }
}

/**
 * GitHub answers "rate limit" for two very different situations, and they need opposite
 * handling:
 *
 *  - the PRIMARY hourly quota (5000 points) is exhausted — retrying is pointless, the
 *    caller has to wait for the documented reset;
 *  - a SECONDARY limit (burst/abuse throttle, keyed on the user id) tripped — the hourly
 *    counter still reads full, and the block lifts on its own within seconds to minutes.
 *
 * The second is what bursts of calls actually hit, and it is indistinguishable from the
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

/** Overridable so a non-standard gh install (and the test stubs) can be pointed at. */
function ghBin(): string {
  return process.env.LITECODE_GH_BIN || "gh";
}

async function spawnGh(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([ghBin(), ...args], {
    env: process.env,
    stdin: "ignore",
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

/** Runs `gh`, retrying a secondary rate limit with backoff; any other failure throws. */
export async function gh(args: string[]): Promise<string> {
  let waited = 0;

  for (let attempt = 1; ; attempt++) {
    const { stdout, stderr, code } = await spawnGh(args);
    if (code === 0) return stdout;

    if (!looksRateLimited(stderr)) {
      throw new GhError(`gh ${args.join(" ")} failed (exit ${code}):\n${stderr.trim()}`, stdout, code);
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

    waited += wait;
    await Bun.sleep(wait);
  }
}

/**
 * One item on a GitHub Project (v2) board (ticket 0050): either backed by an issue, or a
 * draft item with no issue at all. `fields` carries whatever custom field values `gh`
 * reports for the item, keyed by the field's own name lower-cased (e.g. `status`,
 * `priority`, `size`) — a project can name/omit these however it likes, so callers decide
 * what to do with a missing or unrecognized value rather than this module guessing.
 */
export type BoardItem =
  | { kind: "issue"; id: string; repo: string; number: number; title: string; body: string; fields: Record<string, string> }
  | { kind: "draft"; id: string; title: string; body: string; fields: Record<string, string> };

type RawProjectItem = {
  id: string;
  content?: { type?: string; number?: number; title?: string; body?: string; repository?: string };
  [field: string]: unknown;
};

/** Field names `gh project item-list` reports that map to a `BoardItem.fields` key. */
const BOARD_FIELD_KEYS = ["status", "priority", "size"] as const;

function extractFields(raw: RawProjectItem): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of BOARD_FIELD_KEYS) {
    const value = raw[key] ?? raw[key.charAt(0).toUpperCase() + key.slice(1)];
    if (typeof value === "string" && value !== "") fields[key] = value;
  }
  return fields;
}

/**
 * Reads every item on a GitHub Project (v2) board — draft items and issue-backed items
 * alike, with their custom field values — plus, for each issue-backed item, that issue's
 * own title/body (an issue's project-item body is not authoritative; the issue itself is).
 * Read-only: `gh project item-list` and `gh issue view` never write, close, or otherwise
 * modify anything, and both go through the `gh()` wrapper above, so a rate limit hit while
 * importing a large board is retried/reported the same way every other `gh` call is.
 *
 * Content types other than `Issue`/`DraftIssue` (a linked pull request, say) are not
 * tickets and are skipped rather than surfaced as an error.
 */
export async function readBoardItems(owner: string, projectNumber: number): Promise<BoardItem[]> {
  const out = await gh(["project", "item-list", String(projectNumber), "--owner", owner, "--format", "json", "--limit", "1000"]);
  const parsed = JSON.parse(out) as { items: RawProjectItem[] };
  const items: BoardItem[] = [];
  for (const raw of parsed.items) {
    const fields = extractFields(raw);
    const content = raw.content;
    if (content?.type === "DraftIssue") {
      items.push({ kind: "draft", id: raw.id, title: content.title ?? "", body: content.body ?? "", fields });
    } else if (content?.type === "Issue" && content.number !== undefined && content.repository) {
      const issueOut = await gh(["issue", "view", String(content.number), "--repo", content.repository, "--json", "number,title,body"]);
      const issue = JSON.parse(issueOut) as { number: number; title: string; body: string | null };
      items.push({ kind: "issue", id: raw.id, repo: content.repository, number: issue.number, title: issue.title, body: issue.body ?? "", fields });
    }
  }
  return items;
}
