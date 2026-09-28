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

type WorktreeEntry = { path: string; branch: string | null };

/** Parses `git worktree list --porcelain` into path + branch (null when detached). */
async function listWorktrees(root: string): Promise<WorktreeEntry[]> {
  const { stdout, code } = await git(root, ["worktree", "list", "--porcelain"]);
  if (code !== 0) return [];
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> | null = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current?.path) entries.push({ path: current.path, branch: current.branch ?? null });
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      if (current) current.branch = ref.replace(/^refs\/heads\//, "");
    }
  }
  if (current?.path) entries.push({ path: current.path, branch: current.branch ?? null });
  return entries;
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

async function prForBranch(repo: string, branch: string): Promise<PrLookup> {
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
    const hasWorktree = worktrees.some((w) => basename(w.path) === number);
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
  root: string,
  worktreeRoot: string,
  worktrees: WorktreeEntry[],
  tickets: Ticket[],
): Promise<Finding[]> {
  // `git worktree list` reports realpaths (e.g. macOS resolves /var/folders -> /private/var/folders),
  // so both sides of the comparison must go through `realpath` or every worktree silently
  // fails to match and this check reports nothing.
  const absRoot = await realpath(resolve(root, worktreeRoot)).catch(() => resolve(root, worktreeRoot));
  const realRoot = await realpath(root).catch(() => resolve(root));
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

/** A ticket's branch was pushed to origin but no PR (open or closed) exists for it. */
async function checkPushedBranchWithoutPr(root: string, repo: string, tickets: Ticket[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const t of tickets) {
    if (t.status !== "inProgress" && t.status !== "review" && t.status !== "readyToMerge") continue;
    const number = ticketNumber(t.id);
    const branches = await branchesForTicket(root, number);
    for (const branch of branches) {
      if (!(await remoteBranchExists(root, branch))) continue;
      const pr = await prForBranch(repo, branch);
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
async function checkStalePrStatus(root: string, repo: string, tickets: Ticket[]): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const t of tickets) {
    if (t.status !== "review" && t.status !== "readyToMerge") continue;
    const number = ticketNumber(t.id);
    const branches = await branchesForTicket(root, number);
    for (const branch of branches) {
      if (!(await remoteBranchExists(root, branch))) continue;
      const pr = await prForBranch(repo, branch);
      if (pr.kind === "found" && (pr.state === "CLOSED" || pr.state === "MERGED")) {
        findings.push({
          severity: "error",
          message: `${t.id}: status '${t.status}' but its PR (${pr.url}) is ${pr.state.toLowerCase()} — update the ticket`,
        });
      } else if (pr.kind === "unknown") {
        findings.push({
          severity: "warn",
          message: `${t.id}: PR status non vérifié (gh indisponible: ${pr.reason})`,
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

  findings.push(...(await checkOrphanedInProgressTickets(root, worktrees, tickets)));
  findings.push(...(await checkOrphanedWorktrees(root, config.project.worktreeRoot, worktrees, tickets)));
  findings.push(...(await checkPushedBranchWithoutPr(root, config.project.repo, tickets)));
  findings.push(...(await checkStalePrStatus(root, config.project.repo, tickets)));
  findings.push(...(await checkInstallDrift(root, packsRoot, config)));

  return findings;
}
