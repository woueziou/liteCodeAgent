/**
 * `litecode doctor`: detects abandoned/orphaned work that nothing else notices — the local
 * equivalent of `gsd health --repair`/forensics (ticket 0038). Read-only: it never writes
 * anything, only reports. It composes checks that already exist elsewhere (`ticket doctor`,
 * `config doctor`, install lockfile drift) with new ones specific to the worktree/branch/PR
 * lifecycle `implementer` is expected to follow (ADR 0015's worktree-per-ticket flow).
 *
 * GitHub-backed checks (pushed branch without a PR, PR closed/merged but ticket still
 * review/readyToMerge) degrade to a `warn` "unverified" finding when `gh` is unavailable —
 * offline must never turn into a false "nothing's wrong" or a hard failure.
 */

import { resolve, basename } from "node:path";
import { realpath } from "node:fs/promises";
import type { Config } from "./config.ts";
import { buildPlan } from "./install.ts";
import { doctor as ticketDoctor } from "./tickets/doctor.ts";
import { doctor as configDoctor } from "./config-doctor.ts";
import { listTickets } from "./tickets/store.ts";
import type { Ticket } from "./tickets/spec.ts";
import { gh } from "./gh.ts";
import { listPendingAdrs } from "./decisions/pending.ts";

export type Finding = { severity: "error" | "warn"; message: string };

async function git(root: string, args: string[]): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, code };
}

/** The ticket's leading 4-digit number, e.g. `0038-feat-x` -> `0038`. */
function ticketNumber(id: string): string {
  return id.slice(0, 4);
}

type WorktreeEntry = { path: string; branch: string | null; prunable: boolean };

/**
 * Parses `git worktree list --porcelain` into path + branch (null when detached) + whether
 * git itself considers the entry prunable (its directory was deleted but the worktree is
 * still registered — `git worktree prune` would remove it). Note this always lists the main
 * worktree (the primary checkout) first, regardless of which worktree `root` points at —
 * relied on by `primaryCheckoutRoot` below.
 */
async function listWorktrees(root: string): Promise<WorktreeEntry[]> {
  const { stdout, code } = await git(root, ["worktree", "list", "--porcelain"]);
  if (code !== 0) return [];
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) entries.push({ path: current.path, branch: current.branch ?? null, prunable: current.prunable ?? false });
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      if (current) current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable")) {
      if (current) current.prunable = true;
    }
  }
  if (current?.path) entries.push({ path: current.path, branch: current.branch ?? null, prunable: current.prunable ?? false });
  return entries;
}

/**
 * The main worktree (the primary checkout), regardless of which worktree `doctor` itself was
 * invoked from. `git worktree list` always reports the main worktree first (git's own
 * documented ordering), so this holds even when `root` is a ticket worktree under
 * `project.worktreeRoot` — `doctor` run from inside one must still resolve
 * `project.worktreeRoot` relative to the primary checkout, not to itself.
 */
function primaryCheckoutRoot(root: string, worktrees: WorktreeEntry[]): string {
  return worktrees[0]?.path ?? root;
}

/** Local or remote branch (short name) ending in `/<number>`, litecodeagent's naming convention. */
async function branchesForTicket(root: string, number: string): Promise<string[]> {
  const { stdout, code } = await git(root, [
    "for-each-ref",
    "--format=%(refname)",
    "refs/heads",
    "refs/remotes/origin",
  ]);
  if (code !== 0) return [];
  const names = new Set<string>();
  for (const refname of stdout.split("\n").filter(Boolean)) {
    if (refname === "refs/remotes/origin/HEAD") continue;
    const short = refname.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/origin\//, "");
    if (short.endsWith(`/${number}`)) names.add(short);
  }
  return [...names];
}

async function remoteBranchExists(root: string, branch: string): Promise<boolean> {
  const { code } = await git(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  return code === 0;
}

type PrLookup = { kind: "found"; state: string; url: string } | { kind: "missing" } | { kind: "unknown"; reason: string };

async function prForBranchUncached(repo: string, branch: string): Promise<PrLookup> {
  try {
    const out = await gh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "state,url"]);
    const prs = JSON.parse(out) as { state: string; url: string }[];
    if (prs.length === 0) return { kind: "missing" };
    // Prefer an OPEN pr if any; otherwise report the most recently listed one.
    const open = prs.find((p) => p.state === "OPEN");
    return { kind: "found", state: (open ?? prs[0]!).state, url: (open ?? prs[0]!).url };
  } catch (e) {
    // Any failure here — a `GhError` (auth, network, rate limit) as well as a plain `Error`
    // (e.g. `gh` isn't installed at all: `Bun.spawn` throws ENOENT synchronously, before
    // `gh()` ever gets a chance to wrap it) — must degrade to "unverified" rather than
    // propagate. `gh` being entirely missing is exactly the offline case this command has
    // to survive, not just a `gh` that's installed but errors out.
    return { kind: "unknown", reason: (e as Error).message.split("\n")[0]! };
  }
}

/** A single doctor run's `gh pr list` cache, keyed by branch — `checkPushedBranchWithoutPr`
 * and `checkStalePrStatus` both look up the same branch's PR, so without this every branch
 * pays for `gh pr list` twice per `doctor` invocation. */
type PrCache = Map<string, Promise<PrLookup>>;

function newPrCache(): PrCache {
  return new Map();
}

function prForBranch(cache: PrCache, repo: string, branch: string): Promise<PrLookup> {
  const key = `${repo}\u0000${branch}`;
  let lookup = cache.get(key);
  if (!lookup) {
    lookup = prForBranchUncached(repo, branch);
    cache.set(key, lookup);
  }
  return lookup;
}

/** ticket inProgress but no worktree/branch anywhere matching its number: work was abandoned mid-flight. */
async function checkOrphanedInProgressTickets(
  root: string,
  worktrees: WorktreeEntry[],
  tickets: Ticket[],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const t of tickets) {
    if (t.status !== "inProgress") continue;
    const number = ticketNumber(t.id);
    // A prunable worktree's directory is gone (deleted, but git still has it registered) —
    // it doesn't count as "present" here; `checkPrunableWorktrees` reports it separately.
    const hasWorktree = worktrees.some((w) => basename(w.path) === number && !w.prunable);
    const branches = await branchesForTicket(root, number);
    if (!hasWorktree && branches.length === 0) {
      findings.push({
        severity: "error",
        message: `${t.id}: status inProgress but no worktree and no branch found — work may have been abandoned`,
      });
    }
  }
  return findings;
}

/** A worktree under `project.worktreeRoot` whose ticket number has no active (inProgress) ticket. */
async function checkOrphanedWorktrees(
  primaryRoot: string,
  worktreeRoot: string,
  worktrees: WorktreeEntry[],
  tickets: Ticket[],
): Promise<Finding[]> {
  // `worktreeRoot` (e.g. `../worktrees`) is always relative to the primary checkout, never to
  // whichever worktree `doctor` happened to be invoked from — so this must resolve/compare
  // against `primaryRoot`, not `root`.
  // `git worktree list` reports realpaths (e.g. macOS resolves /var/folders -> /private/var/folders),
  // so both sides of the comparison must go through `realpath` or every worktree silently
  // fails to match and this check reports nothing.
  const absRoot = await realpath(resolve(primaryRoot, worktreeRoot)).catch(() => resolve(primaryRoot, worktreeRoot));
  const realRoot = await realpath(primaryRoot).catch(() => resolve(primaryRoot));
  // "active" means the worktree is still legitimately in use: an implementer resumed on it
  // (`inProgress`), or a `review`/`readyToMerge` ticket getting a same-PR review fixup (the
  // workflow this very fix went through — see the `implementer` flow's resume-on-review-fixup
  // step). Only once a ticket reaches `done`/`blocked` is its worktree unambiguously stale.
  const activeNumbers = new Set(
    tickets.filter((t) => t.status === "inProgress" || t.status === "review" || t.status === "readyToMerge")
      .map((t) => ticketNumber(t.id)),
  );
  const findings: Finding[] = [];
  for (const w of worktrees) {
    // A prunable worktree's directory is already gone — it's reported by
    // `checkPrunableWorktrees` instead of being evaluated (and mis-evaluated, since its path
    // no longer resolves) here.
    if (w.prunable) continue;
    const abs = await realpath(w.path).catch(() => resolve(w.path));
    if (abs === realRoot) continue; // the primary checkout itself always shows up here
    if (!abs.startsWith(`${absRoot}/`) && abs !== absRoot) continue;
    const number = basename(abs);
    if (!/^\d{4}$/.test(number)) continue; // not litecodeagent's `<worktreeRoot>/<NNNN>` convention
    if (!activeNumbers.has(number)) {
      findings.push({
        severity: "warn",
        message: `worktree at ${w.path} has no matching inProgress ticket (number ${number}) — stale, remove it`,
      });
    }
  }
  return findings;
}

/** A worktree git still has registered whose directory was deleted out from under it — not
 * counted as "present" by the other checks, and needs `git worktree prune` to clear. */
function checkPrunableWorktrees(worktrees: WorktreeEntry[]): Finding[] {
  return worktrees
    .filter((w) => w.prunable)
    .map((w) => ({
      severity: "warn" as const,
      message: `worktree at ${w.path} is registered but its directory is gone (prunable) — run \`git worktree prune\``,
    }));
}

/** A ticket's branch was pushed to origin but no PR (open or closed) exists for it. */
async function checkPushedBranchWithoutPr(root: string, repo: string, tickets: Ticket[], cache: PrCache): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const t of tickets) {
    if (t.status !== "inProgress" && t.status !== "review" && t.status !== "readyToMerge") continue;
    const number = ticketNumber(t.id);
    const branches = await branchesForTicket(root, number);
    for (const branch of branches) {
      // "pushed but no PR" only makes sense for a branch that's actually on origin.
      if (!(await remoteBranchExists(root, branch))) continue;
      const pr = await prForBranch(cache, repo, branch);
      if (pr.kind === "missing") {
        findings.push({
          severity: "error",
          message: `${t.id}: branch '${branch}' is pushed but has no PR`,
        });
      } else if (pr.kind === "unknown") {
        findings.push({
          severity: "warn",
          message: `${t.id}: branch '${branch}' PR status non vérifié (gh indisponible: ${pr.reason})`,
        });
      }
    }
  }
  return findings;
}

/** A ticket sitting in review/readyToMerge whose PR is actually closed or merged. */
async function checkStalePrStatus(root: string, repo: string, tickets: Ticket[], cache: PrCache): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const t of tickets) {
    if (t.status !== "review" && t.status !== "readyToMerge") continue;
    const number = ticketNumber(t.id);
    // A ticket can have more than one branch: an abandoned first attempt (its PR closed) and
    // a live second attempt (its PR open). Also don't gate on `remoteBranchExists` — once a
    // PR merges, `gh pr merge --delete-branch` removes the remote branch, but `gh pr list
    // --head <branch>` still finds the PR by branch name, and the local branch (still
    // checked out in the ticket's worktree) still matches `branchesForTicket`. Gating on the
    // remote branch's existence would mask exactly the merged/closed case this check exists
    // to catch.
    const branches = await branchesForTicket(root, number);
    if (branches.length === 0) continue;
    const lookups = await Promise.all(
      branches.map(async (branch) => ({ branch, pr: await prForBranch(cache, repo, branch) })),
    );
    // Any branch with a live, open PR means this ticket's work is still legitimately in
    // flight — a sibling branch's closed/merged PR (an abandoned earlier attempt) isn't
    // stale, it's just history.
    const hasOpenPr = lookups.some((l) => l.pr.kind === "found" && l.pr.state === "OPEN");
    if (!hasOpenPr) {
      const closed = lookups.find((l) => l.pr.kind === "found" && (l.pr.state === "CLOSED" || l.pr.state === "MERGED"));
      if (closed && closed.pr.kind === "found") {
        findings.push({
          severity: "error",
          message: `${t.id}: status '${t.status}' but its PR (${closed.pr.url}) is ${closed.pr.state.toLowerCase()} — update the ticket`,
        });
      }
    }
    for (const l of lookups) {
      if (l.pr.kind === "unknown") {
        findings.push({
          severity: "warn",
          message: `${t.id}: PR status non vérifié (gh indisponible: ${l.pr.reason})`,
        });
      }
    }
  }
  return findings;
}

/** Install lockfile drift (hand-edited managed files), reusing `buildPlan`'s own drift detection. */
async function checkInstallDrift(root: string, packsRoot: string, config: Config): Promise<Finding[]> {
  let plan: Awaited<ReturnType<typeof buildPlan>>;
  try {
    plan = await buildPlan(root, packsRoot, config);
  } catch (e) {
    // `buildPlan` also validates config/skill references (unrelated to drift) and throws on
    // a violation. That's `config doctor`'s job to report; here it must not crash the rest
    // of `doctor`'s checks, so it degrades to a single finding instead.
    return [{ severity: "warn", message: `install plan could not be computed: ${(e as Error).message.split("\n")[0]}` }];
  }
  const findings: Finding[] = [];
  for (const entry of plan.entries) {
    if (entry.status === "drift") {
      findings.push({ severity: "warn", message: `${entry.rel}: hand-edited since the last install (drift)` });
    }
  }
  if (plan.hook?.status === "drift") {
    findings.push({ severity: "warn", message: `${plan.hook.rel}: hand-edited since the last install (drift)` });
  }
  return findings;
}

/** Reads a file from the primary checkout's working tree; `null` if it can't be read (deleted, binary read failure). */
async function readWorkingFile(root: string, rel: string): Promise<string | null> {
  try {
    return await Bun.file(resolve(root, rel)).text();
  } catch {
    return null;
  }
}

/** A ticket branch's committed content for a path at its current tip, or `null` if that path doesn't exist there. */
async function branchFileContent(root: string, branch: string, rel: string): Promise<string | null> {
  const { stdout, code } = await git(root, ["show", `${branch}:${rel}`]);
  return code === 0 ? stdout : null;
}

/**
 * An uncommitted change in the primary checkout that's byte-identical to a ticket branch's
 * already-committed content for that same path: a sub-agent almost certainly wrote into the
 * primary checkout instead of its worktree (tickets 0032, 0045 — the second broke
 * `verify-report` for a ticket working in parallel), not a human's legitimate in-progress
 * edit. Only ticket branches still in flight (inProgress/review/readyToMerge) are checked —
 * a done/blocked ticket's branch content matching a stray edit is coincidence, not a leak.
 */
async function checkPrimaryCheckoutLeak(root: string, tickets: Ticket[]): Promise<Finding[]> {
  // `-z --untracked-files=all`: `-z` gives NUL-separated, unquoted records (so a path with a
  // space or non-ASCII byte, which the default terminal-quoted format would mangle, comes
  // through verbatim), and `--untracked-files=all` lists every file inside a newly created
  // untracked directory individually instead of collapsing it into one `?? dir/` line — a
  // leak into a brand-new directory would otherwise never show up as a per-file entry.
  const { stdout, code } = await git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (code !== 0) return [];
  const records = stdout.split("\0").filter(Boolean);
  const changed: string[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    // Each record is `XY <path>`. A rename/copy (X or Y is 'R'/'C') is followed by one more
    // NUL-separated record holding the origin path, which this check has no use for.
    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (path) changed.push(path);
    if (status.includes("R") || status.includes("C")) i++;
  }
  if (changed.length === 0) return [];

  const activeTickets = tickets.filter(
    (t) => t.status === "inProgress" || t.status === "review" || t.status === "readyToMerge",
  );
  const findings: Finding[] = [];
  for (const rel of changed) {
    const working = await readWorkingFile(root, rel);
    if (working === null) continue;
    for (const t of activeTickets) {
      const branches = await branchesForTicket(root, ticketNumber(t.id));
      for (const branch of branches) {
        const committed = await branchFileContent(root, branch, rel);
        if (committed !== null && committed === working) {
          findings.push({
            severity: "error",
            message: `${rel}: uncommitted change in the primary checkout is identical to branch '${branch}' (${t.id}) — likely a leaked sub-agent write, discard it here`,
          });
        }
      }
    }
  }
  return findings;
}

/**
 * A ticket blocked behind an unapproved ADR draft (ticket 0047): `implementer` stopped at
 * the ADR gate and is waiting on a human, but nothing else says so or points at where to
 * read/approve it. Reuses `listPendingAdrs` (`src/decisions/pending.ts`), the same
 * detector the dashboard's ADR screen and `ticket list` both use.
 */
async function checkPendingAdrDrafts(root: string, tickets: Ticket[]): Promise<Finding[]> {
  const pending = await listPendingAdrs(root, tickets);
  return pending.map((p) => ({
    severity: "warn" as const,
    message: `${p.ticketId}: ADR draft awaiting approval (${p.adrPath}) — read/approve it in ${p.ticketPath}`,
  }));
}

export type DoctorContext = { root: string; packsRoot: string; config: Config };

export async function doctor(ctx: DoctorContext): Promise<Finding[]> {
  const { root, packsRoot, config } = ctx;
  const findings: Finding[] = [];

  // Reuse ticket doctor / config doctor verbatim.
  const ticketFindings = await ticketDoctor(root, config.project.tickets.dir);
  findings.push(...ticketFindings);
  const configFindings = await configDoctor(packsRoot, config);
  for (const f of configFindings) findings.push(f);

  const tickets = await listTickets(root, config.project.tickets.dir);
  const worktrees = await listWorktrees(root);
  const primaryRoot = primaryCheckoutRoot(root, worktrees);
  const prCache = newPrCache();

  findings.push(...(await checkOrphanedInProgressTickets(root, worktrees, tickets)));
  findings.push(...(await checkOrphanedWorktrees(primaryRoot, config.project.worktreeRoot, worktrees, tickets)));
  findings.push(...checkPrunableWorktrees(worktrees));
  findings.push(...(await checkPushedBranchWithoutPr(root, config.project.repo, tickets, prCache)));
  findings.push(...(await checkStalePrStatus(root, config.project.repo, tickets, prCache)));
  findings.push(...(await checkInstallDrift(root, packsRoot, config)));
  findings.push(...(await checkPrimaryCheckoutLeak(root, tickets)));
  findings.push(...(await checkPendingAdrDrafts(root, tickets)));

  return findings;
}
