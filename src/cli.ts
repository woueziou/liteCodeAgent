#!/usr/bin/env bun
import { resolve, dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig, CONFIG_FILENAME, TARGETS, TARGET_INFO, selectedTargets, type InstallTarget } from "./config.ts";
import { buildPlan, applyPlan } from "./install.ts";
import { listPacks, loadPack } from "./packs.ts";
import { readLockfile } from "./lockfile.ts";
import { RateLimitError, readBoardItems } from "./gh.ts";
import { runImportBoard } from "./tickets/import-board.ts";
import { doctor as ticketDoctor } from "./tickets/doctor.ts";
import { buildDashboard } from "./dashboard/build.ts";
import { renderDashboard } from "./dashboard/render.ts";
import { startDashboardServer, DEFAULT_PORT, DEFAULT_HOST } from "./dashboard/serve.ts";
import { parseReport, verifyReport, type Finding as ReportFinding } from "./report/verify.ts";
import { realProbes, realResumeProbes } from "./report/probes.ts";
import { doctor as configDoctor, computeAgentSkillsFix } from "./config-doctor.ts";
import { doctor as fullDoctor } from "./doctor.ts";
import { listPendingAdrs } from "./decisions/pending.ts";
import { resumeState } from "./resume.ts";
import { appendTicketNote, createTicket, listTickets, listTicketsDetailed, writeTicket } from "./tickets/store.ts";
import {
  ALLOWED_TRANSITIONS,
  CLARIFICATION_MARKER,
  CURRENT_SCHEMA_VERSION,
  hasUnresolvedClarification,
  isTransitionAllowed,
  migrateTicket,
  PRIORITIES,
  SIZES,
  TICKET_STATUSES,
  type Priority,
  type Size,
  type StatusRole,
} from "./tickets/spec.ts";
import { checkBranchGuard } from "./guard-branch.ts";
import { findDuplicate, localDedupeCandidates } from "./tickets/dedupe.ts";
import { init, summarize } from "./init.ts";
import { applyConfigMutation } from "./config-edit.ts";
import { confirm, isInteractive, multiSelect } from "./prompt.ts";
import { upgrade } from "./upgrade.ts";
import { applyUpgrade, hasChanges, hasSkips, planUpgrade } from "./project-upgrade.ts";
import {
  RunCancelledError,
  RunnerExecutionError,
  runConfiguredAgentDetailed,
  type RunOutcome,
  type TraceEvent,
} from "./runner/index.ts";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS_ROOT = join(KIT_ROOT, "packs");
const VERSION = (await Bun.file(join(KIT_ROOT, "package.json")).json()).version as string;

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

function usage(): void {
  console.log(`${c.bold("litecodeagent")} ${c.dim(`v${VERSION}`)}

  ${c.bold("bunx litecodeagent setup")} [--apply] [--yes]
                                     initialize the project if needed, then render its packs
                                     ${c.dim("--targets claude-code,codex,pi,opencode,kilo-code (defaults to all)")}
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent init")} [--yes] [--targets …] interactive setup: detects your repo, asks, writes the config
                                     ${c.dim("--yes skips the questions and uses only what it detects")}
  ${c.bold("bunx litecodeagent targets")}                  list the coding tools you can install into
  ${c.bold("bunx litecodeagent packs")}                    list available packs
  ${c.bold("bunx litecodeagent install")} [--apply] [--force]
                                     render packs into configured AI coding tools
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent status")}                   show installed packs + drift
  ${c.bold("bunx litecodeagent config")} [show|edit|get|set|targets|packs|doctor]
                                     view or change litecode.config.json from the CLI
                                     ${c.dim("targets/packs: run with no argument to pick from a list")}
                                     ${c.dim("or set|add|remove <list>  ·  --apply runs install")}
  ${c.bold("bunx litecodeagent config doctor")} [--fix]     report config paths the installed packs require but are missing
                                     ${c.dim("--fix fills in missing agentSkills keys and writes the config")}
  ${c.bold("bunx litecodeagent run")} <agent> --prompt <text>
                                     run a pack agent through the configured API provider
                                     ${c.dim("--prompt-file <path>; --trace; --usage; --json; --record <path>")}
  ${c.bold("bunx litecodeagent ticket new")} --title <t> --label <bug|feature|doc|chore> [--body <text>] [--priority ..] [--size ..] [--force]
                                     draft a ticket file; blocks if its title reads like an existing
                                     ticket's — pass --force to create anyway
  ${c.bold("bunx litecodeagent ticket list")}              list ticket files with their status, priority and size
  ${c.bold("bunx litecodeagent ticket doctor")}            check the ticket directory for malformed/misplaced/duplicate/outdated files
  ${c.bold("bunx litecodeagent ticket migrate")} [--apply] [--force] rewrite schema-v1 (GitHub-synced) tickets as local-only v2
                                     ${c.dim("refuses to drop unknown frontmatter keys unless --force")}
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent ticket import-board")} [--apply] [--board <owner>/<number>]  one-time import of the old GitHub Project board's items as local tickets
                                     ${c.dim("read-only on GitHub; requires project.board.number, or --board if config was already cleaned; see ADR 0019")}
                                     ${c.dim("(dry-run by default; --apply writes)")}
  ${c.bold("bunx litecodeagent ticket move")} <id> <status>    validate and write a ticket's status transition
                                     ${c.dim(`refuses a transition the pipeline's status machine doesn't allow (e.g. planned -> review)`)}
                                     ${c.dim(`statuses: ${TICKET_STATUSES.join(", ")}`)}
  ${c.bold("bunx litecodeagent ticket note")} <id> --file <path>   append the file's contents as a note to a ticket's body
                                     ${c.dim("pair with --project <primary-checkout> to write there from an isolated worktree (ADR 0020)")}
  ${c.bold("bunx litecodeagent guard-branch")}              refuse (exit 1) a commit on the default branch, unless it holds only ticket files
                                     ${c.dim("called from .githooks/pre-commit; not meant to be run by a human")}
  ${c.bold("bunx litecodeagent dashboard")} --build [--out <path>]
                                     regenerate the committed standalone HTML dashboard snapshot from the local
                                     ticket buffer and docs/decisions/ — goes stale as soon as either changes
                                     ${c.dim("--out defaults to docs/dashboard.html")}
  ${c.bold("bunx litecodeagent dashboard")} --serve [--port <n>] [--host <h>] [--allow-host <name[:port]>]...
                                     start a local, read-only server that re-reads the ticket buffer and
                                     docs/decisions/ on every request — always live, never writes to the repo
                                     ${c.dim("--port defaults to 4173, --host defaults to 127.0.0.1")}
                                     ${c.dim("--allow-host repeatable, allows extra Host header values (no wildcard); required to")}
                                     ${c.dim("  reach the server from another machine when --host 0.0.0.0 or :: is used")}
                                     ${c.dim("--build and --serve are mutually exclusive; one of the two is required")}
  ${c.bold("bunx litecodeagent doctor")}                    detect orphaned work: stranded worktrees/branches, PR-less
                                     branches, stale review/readyToMerge tickets, lockfile drift
                                     ${c.dim("(read-only; GitHub checks report 'non vérifié' when gh is unavailable)")}
  ${c.bold("bunx litecodeagent verify-report")} [--file <path>] [--json]
                                     check an implementer's final report (STATUS/TICKET/BRANCH/PR/CHECK_OUTPUT)
                                     against git, gh and the ticket buffer; exits 1 on any contradiction
                                     ${c.dim("reads the report from stdin when --file is omitted")}
  ${c.bold("bunx litecodeagent resume")} <ticket> [--json]
                                     reconstruct where an implementer run left off, from the ticket's progress
                                     journal note, cross-checked against the worktree/branch/PR; prints the
                                     step to resume at, or the discrepancies blocking that
                                     ${c.dim("complements `doctor`, which finds orphaned work with no journal to go on")}
  ${c.bold("bunx litecodeagent upgrade")} [--yes]  bring this project up to date with the running release, in one go:
                                     re-render agents, remove files older versions generated (unedited ones only),
                                     migrate tickets, drop obsolete config keys and data files
                                     ${c.dim("shows the plan, then asks before applying; --yes applies without asking")}
                                     ${c.dim("a legacy git-clone install (install.sh) updates itself first; --no-self-update skips that")}
                                     ${c.dim("exits 0 only when the project is fully up to date, 1 when anything is left pending")}

Global: --project <dir>   target repo (default: cwd)
`);
}

async function cmdSetup(root: string, argv: string[]): Promise<number> {
  const configPath = resolve(root, CONFIG_FILENAME);
  if (!(await Bun.file(configPath).exists())) {
    const packsArg = arg(argv, "--packs");
    const yes = argv.includes("--yes") || argv.includes("-y");
    const path = await init(root, {
      packs: packsArg ? packsArg.split(",").map((s) => s.trim()) : undefined,
      targets: parseTargets(arg(argv, "--targets")),
      yes,
      packsRoot: PACKS_ROOT,
    });
    console.log(`\n${c.green("Wrote")} ${path}\n`);
  }
  return cmdInstall(root, argv);
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * Removes a `--flag value` pair from anywhere in argv. `root` (from `--project`) is
 * already resolved once, globally, before any subcommand dispatch — but `ticket move`/
 * `ticket note` parse their remaining arguments positionally (`argv[2]`, `argv[3]`), so a
 * `--project <path>` left in place would shift those positions wherever an agent happened
 * to put it in the command line (ticket 0057 / ADR 0020: an isolated implementer needs
 * `--project` on every ticket-writing call, not just at the end). Stripping it here once,
 * before positional parsing, means every ticket subcommand accepts `--project` anywhere.
 */
function stripFlag(argv: string[], name: string): string[] {
  const i = argv.indexOf(name);
  if (i === -1) return argv;
  return [...argv.slice(0, i), ...argv.slice(i + 2)];
}

/** Like `arg`, but collects every occurrence — for a repeatable flag such as `--allow-host`. */
function repeatedArg(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] !== undefined) values.push(argv[i + 1]!);
  }
  return values;
}

function parseTargets(value: string | undefined): InstallTarget[] | undefined {
  if (!value) return undefined;
  const requested = value.split(",").map((part) => part.trim()).filter(Boolean);
  const invalid = requested.filter((target) => !(TARGETS as readonly string[]).includes(target));
  if (invalid.length) throw new Error(`Unknown target(s): ${invalid.join(", ")}. Choose from ${TARGETS.join(", ")}.`);
  return [...new Set(requested)] as InstallTarget[];
}

/**
 * Reads the configured tools for display. Returns null only when the project has no
 * config at all: a config that exists but still has `TODO` placeholders makes
 * `loadConfig` throw, and reporting that as "not configured" would be a lie.
 */
async function currentTargets(root: string): Promise<InstallTarget[] | null> {
  const file = Bun.file(resolve(root, CONFIG_FILENAME));
  if (!(await file.exists())) return null;
  try {
    const { config } = await loadConfig(root);
    return selectedTargets(config);
  } catch {
    const raw = (await file.json().catch(() => null)) as { target?: string; targets?: string[] } | null;
    const listed = raw?.targets ?? (raw?.target ? [raw.target] : []);
    return listed.filter((t): t is InstallTarget => (TARGETS as readonly string[]).includes(t));
  }
}

async function cmdTargets(root: string): Promise<number> {
  const enabled = await currentTargets(root);
  console.log(`${c.bold("Coding tools LiteCodeAgent can install into")}\n`);
  for (const target of TARGETS) {
    const info = TARGET_INFO[target];
    const on = enabled?.includes(target) ?? false;
    const mark = enabled === null ? c.dim("·") : on ? c.green("\u25cf") : c.dim("\u25cb");
    const state = enabled === null ? "" : on ? c.green("  on") : c.dim("  off");
    console.log(`  ${mark} ${c.bold(info.label.padEnd(12))} ${c.dim(target.padEnd(12))}${state}`);
    console.log(`      ${info.description}`);
    console.log(`      ${c.dim(`installs into ${info.directory}`)}\n`);
  }
  if (enabled === null) {
    console.log(c.dim(`No ${CONFIG_FILENAME} here yet. Run \`litecode init\` to choose.`));
  } else {
    console.log(c.dim("Change them with `litecode config targets` (interactive)"));
    console.log(c.dim("or `litecode config targets set claude-code,pi`."));
  }
  return 0;
}

async function cmdPacks(): Promise<number> {
  for (const name of await listPacks(PACKS_ROOT)) {
    const pack = await loadPack(PACKS_ROOT, name);
    const agents = pack.files.filter((f) => f.rel.startsWith("agents/")).length;
    const skills = pack.files.filter((f) => f.rel.startsWith("skills/")).length;
    console.log(
      `${c.bold(pack.manifest.name.padEnd(10))} ${c.dim(`v${pack.manifest.version}`)}  ` +
        `${agents} agents, ${skills} skills`,
    );
    console.log(`  ${c.dim(pack.manifest.description)}`);
  }
  return 0;
}

async function cmdInstall(root: string, argv: string[]): Promise<number> {
  const { config } = await loadConfig(root);
  const plan = await buildPlan(root, PACKS_ROOT, config);
  const apply = argv.includes("--apply");

  const counts = { create: 0, update: 0, unchanged: 0, drift: 0, preexisting: 0 };
  for (const e of plan.entries) counts[e.status]++;
  if (plan.hook) counts[plan.hook.status]++;

  console.log(`${c.bold("Project")}  ${root}`);
  console.log(`${c.bold("Tools")}    ${selectedTargets(config).join(", ")}`);
  console.log(`${c.bold("Packs")}    ${Object.entries(plan.packVersions).map(([n, v]) => `${n}@${v}`).join(", ")}`);
  console.log("");
  for (const e of plan.entries) {
    const tag =
      e.status === "create" ? c.green("create  ")
      : e.status === "update" ? c.cyan("update  ")
      : e.status === "drift" ? c.red("DRIFT   ")
      : c.dim("ok      ");
    console.log(`  ${tag} ${e.rel} ${c.dim(`(${e.pack})`)}`);
  }
  if (plan.hook) {
    const tag =
      plan.hook.status === "create" ? c.green("create  ")
      : plan.hook.status === "update" ? c.cyan("update  ")
      : plan.hook.status === "drift" ? c.red("DRIFT   ")
      : plan.hook.status === "preexisting" ? c.yellow("skip    ")
      : c.dim("ok      ");
    console.log(`  ${tag} ${plan.hook.rel} ${c.dim(`(${plan.hook.pack}, git hook)`)}`);
  }
  for (const orphan of plan.orphans) {
    console.log(`  ${c.yellow("orphan  ")} ${orphan} ${c.dim("(no longer produced; left on disk, remove manually)")}`);
  }

  console.log(
    `\n${counts.create} to create, ${counts.update} to update, ${counts.unchanged} unchanged` +
      (counts.drift ? c.red(`, ${counts.drift} hand-edited`) : ""),
  );

  if (!apply) {
    console.log(c.dim("\nDry run. Re-run with --apply to write these files."));
    return counts.drift > 0 ? 1 : 0;
  }
  await applyPlan(root, plan, VERSION, {
    force: argv.includes("--force"),
    defaultBranch: config.project.defaultBranch,
    allowDefaultBranchCommits: config.project.allowDefaultBranchCommits,
  });
  console.log(c.green("\nInstalled."));
  return 0;
}

async function cmdDoctor(root: string): Promise<number> {
  const { config } = await loadConfig(root);
  const findings = await fullDoctor({ root, packsRoot: PACKS_ROOT, config });
  if (findings.length === 0) {
    console.log(c.green("No orphaned work found: tickets, worktrees, branches, PRs and install files are all consistent."));
    return 0;
  }
  for (const f of findings) {
    console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
  }
  return findings.some((f) => f.severity === "error") ? 1 : 0;
}

async function cmdStatus(root: string): Promise<number> {
  const lockPaths: [InstallTarget, string][] = [
    ["claude-code", ".claude/.litecode-lock.json"],
    ["codex", ".codex/.litecode-lock.json"],
    ["pi", ".pi/.litecode-lock.json"],
    ["opencode", ".opencode/.litecode-lock.json"],
    ["kilo-code", ".kilo/.litecode-lock.json"],
  ];
  const locks = (await Promise.all(lockPaths.map(async ([target, path]) => [target, await readLockfile(root, path)] as const)))
    .filter((entry): entry is readonly [InstallTarget, NonNullable<(typeof entry)[1]>] => entry[1] !== null);
  if (locks.length === 0) {
    console.log("No LiteCodeAgent install found in this repo.");
    return 1;
  }
  for (const [target, lock] of locks) {
    console.log(`${c.bold(target)} · litecode v${lock.litecodeVersion}  ${c.dim(lock.installedAt)}`);
    for (const [name, version] of Object.entries(lock.packs)) console.log(`  ${name}@${version}`);
    console.log(`  ${Object.keys(lock.files).length} managed files`);
  }
  console.log(c.dim("\nFiles not listed in LiteCodeAgent lockfiles remain project-owned and are never touched."));
  return 0;
}

function traceLine(event: TraceEvent): string {
  if (event.type === "agent-start") return `${"  ".repeat(event.depth)}→ ${event.agent} (${event.model})`;
  if (event.type === "agent-end") return `${"  ".repeat(event.depth)}← ${event.agent} (${event.turns} turn${event.turns === 1 ? "" : "s"})`;
  if (event.type === "tool-start") return `  ${"  ".repeat(1)}${event.agent}: ${event.tool}`;
  if (event.type === "tool-end") return "";
  if (event.type === "retry") {
    const request = event.requestId ? ` · ${event.requestId}` : "";
    return `  ${event.agent}: retry ${event.retry}/${event.maxRetries} after HTTP ${event.status} in ${event.delayMs}ms${request}`;
  }
  const cost = event.totalCostUsd === null ? "cost unknown" : `$${event.totalCostUsd.toFixed(6)}`;
  if (!event.usage) return `  ${event.agent}: usage unavailable · ${cost}`;
  return `  ${event.agent}: ${event.usage.input} in / ${event.usage.output} out · ${cost}`;
}

function usageLine(report: RunOutcome): string {
  const cost = report.usage.costUsd === null ? "cost unknown" : `$${report.usage.costUsd.toFixed(6)}`;
  return `${report.usage.requests} request${report.usage.requests === 1 ? "" : "s"} · ` +
    `${report.usage.input} input / ${report.usage.output} output tokens · ${cost}`;
}

async function cmdRun(root: string, argv: string[]): Promise<number> {
  const agent = argv[1];
  if (!agent) throw new Error("Usage: bunx litecodeagent run <agent> --prompt <text>");
  const directPrompt = arg(argv, "--prompt");
  const promptFile = arg(argv, "--prompt-file");
  if (directPrompt && promptFile) throw new Error("Pass either --prompt or --prompt-file, not both");
  let prompt = directPrompt;
  if (promptFile) prompt = await Bun.file(resolve(root, promptFile)).text();
  if (!prompt && !process.stdin.isTTY) prompt = await Bun.stdin.text();
  if (!prompt?.trim()) throw new Error("Provide a prompt with --prompt, --prompt-file, or stdin");

  const { config } = await loadConfig(root);
  const trace = argv.includes("--trace")
    ? (event: TraceEvent) => {
        const line = traceLine(event);
        if (line) console.error(c.dim(line));
      }
    : undefined;
  const controller = new AbortController();
  const cancel = (signal: string) => controller.abort(new RunCancelledError(`Run cancelled by ${signal}`));
  const onSigint = () => cancel("SIGINT");
  const onSigterm = () => cancel("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  let report: RunOutcome;
  try {
    report = await runConfiguredAgentDetailed({
      projectRoot: root,
      packsRoot: PACKS_ROOT,
      config,
      agent,
      prompt,
      trace,
      signal: controller.signal,
    });
  } catch (error) {
    if (!(error instanceof RunnerExecutionError)) throw error;
    report = error.report;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  const recordPath = arg(argv, "--record");
  if (recordPath) {
    const destination = resolve(root, recordPath);
    await mkdir(dirname(destination), { recursive: true });
    await Bun.write(destination, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else if (report.status === "completed") console.log(report.output);
  else console.error(c.red(`\n${report.error.message}`));
  if (!argv.includes("--json") && (argv.includes("--usage") || argv.includes("--trace"))) {
    console.error(c.dim(usageLine(report)));
  }
  return report.status === "completed" ? 0 : 1;
}

/** Turns `config targets` / `config packs` with no action into a pick-from-a-list prompt. */
async function chooseInteractively(
  root: string,
  kind: "targets" | "packs",
): Promise<string | null> {
  if (!isInteractive()) {
    console.error(
      `Usage: bunx litecodeagent config ${kind} <set|add|remove> <list>\n` +
        `Run it in a terminal to pick from a list instead, or see \`litecode ${kind}\`.`,
    );
    return null;
  }

  const { config } = await loadConfig(root);
  if (kind === "targets") {
    const enabled = selectedTargets(config);
    const picked = await multiSelect(
      "Which coding tools should LiteCodeAgent install into?",
      TARGETS.map((target) => ({
        label: TARGET_INFO[target].label,
        hint: `${TARGET_INFO[target].description} \u2192 ${TARGET_INFO[target].directory}`,
        value: target as string,
        selected: enabled.includes(target),
      })),
    );
    return picked.join(",");
  }

  const available = await listPacks(PACKS_ROOT);
  const picked = await multiSelect(
    "Which packs should be installed?",
    await Promise.all(
      available.map(async (name) => {
        const pack = await loadPack(PACKS_ROOT, name);
        return {
          label: name,
          hint: pack.manifest.description,
          value: name as string,
          selected: config.packs.includes(name),
        };
      }),
    ),
  );
  return picked.join(",");
}

async function cmdConfig(root: string, argv: string[]): Promise<number> {
  const sub = argv[1];
  const apply = argv.includes("--apply");

  if (sub === "doctor") {
    const { config } = await loadConfig(root);
    const findings = await configDoctor(PACKS_ROOT, config);
    if (findings.length === 0) {
      console.log(c.green(`${CONFIG_FILENAME} has every config path the installed packs require.`));
      return 0;
    }
    for (const f of findings) console.log(`  ${c.red("error")} ${f.message}`);
    if (!argv.includes("--fix")) {
      console.log(c.dim("\nRun `bunx litecodeagent config doctor --fix` to fill in missing agentSkills keys."));
      return 1;
    }
    const fill = await computeAgentSkillsFix(PACKS_ROOT, config);
    const { path, changed } = await applyConfigMutation(root, PACKS_ROOT, { kind: "fix-agent-skills", fill });
    if (changed) console.log(`\n${c.green("Fixed")} ${path}`);
    return 0;
  }

  // An empty `config targets` used to be an error; now it opens the picker.
  if ((sub === "targets" || sub === "packs") && !argv[2]) {
    const chosen = await chooseInteractively(root, sub);
    if (chosen === null) return 1;
    if (!chosen) {
      console.log(c.dim("Nothing selected; leaving the config unchanged."));
      return 0;
    }
    argv = [argv[0] ?? "config", sub, "set", chosen, ...(apply ? ["--apply"] : [])];
  }

  const mutation = (() => {
    if (!sub || sub === "show") return { kind: "show" as const };
    if (sub === "edit") return { kind: "edit" as const };
    if (sub === "get") {
      const path = argv[2];
      if (!path) throw new Error("Usage: bunx litecodeagent config get <path>");
      return { kind: "get" as const, path };
    }
    if (sub === "set") {
      const path = argv[2];
      const value = argv[3];
      if (!path || value === undefined) throw new Error("Usage: bunx litecodeagent config set <path> <value>");
      return { kind: "set" as const, path, value };
    }
    if (sub === "targets" || sub === "packs") {
      const action = argv[2];
      const value = argv[3];
      if (!action || !value || !["set", "add", "remove"].includes(action)) {
        throw new Error(`Usage: bunx litecodeagent config ${sub} <set|add|remove> <list>`);
      }
      const verb = action as "set" | "add" | "remove";
      return sub === "targets"
        ? { kind: "targets" as const, action: verb, value }
        : { kind: "packs" as const, action: verb, value };
    }
    throw new Error(`Unknown config command: ${sub}`);
  })();

  const { config, path, changed } = await applyConfigMutation(root, PACKS_ROOT, mutation);
  if (changed) {
    console.log(`${c.green("Updated")} ${path}`);
    if (mutation.kind === "targets" || mutation.kind === "packs" || mutation.kind === "set") {
      console.log(`${c.bold("Tools")}    ${selectedTargets(config).join(", ")}`);
      console.log(`${c.bold("Packs")}    ${config.packs.join(", ")}`);
    }
  } else if (mutation.kind === "edit" && !changed) {
    console.log(c.dim("No changes."));
  }

  if (apply && changed) return cmdInstall(root, ["install", "--apply"]);
  if (apply && !changed) console.log(c.dim("Nothing to install."));
  if (changed && !apply) {
    console.log(c.dim("\nRe-run with --apply to render packs for the new settings."));
  }
  return 0;
}

async function cmdGuardBranch(root: string, argv: string[]): Promise<number> {
  const { config } = await loadConfig(root);
  const git = async (...args: string[]): Promise<string> => {
    // Inside a pre-commit hook git exports GIT_INDEX_FILE, so `diff --cached` sees exactly
    // what this commit carries, including the temporary index of `git commit -- <paths>`.
    const proc = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out;
  };
  const branch = arg(argv, "--branch") ?? (await git("branch", "--show-current")).trim();
  // Paths from `diff --cached` are relative to the repo's top level; the project root may
  // be a subdirectory of it, so the tickets dir gets the same prefix.
  const prefix = (await git("rev-parse", "--show-prefix")).trim();
  const stagedPaths = (await git("diff", "--cached", "--name-only", "-z")).split("\0").filter(Boolean);
  const result = checkBranchGuard({
    branch,
    defaultBranch: config.project.defaultBranch,
    allowDefaultBranchCommits: config.project.allowDefaultBranchCommits,
    envOverride: process.env.LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT,
    stagedPaths,
    ticketsDir: `${prefix}${config.project.tickets.dir.replace(/^\.\//, "")}`,
  });
  if (!result.allowed) {
    console.log(c.red(`guard-branch: ${result.reason}`));
    return 1;
  }
  return 0;
}

async function cmdTicket(root: string, argv: string[]): Promise<number> {
  const sub = argv[1];
  const { config } = await loadConfig(root);
  const dir = config.project.tickets.dir;

  if (!config.project.tickets.enabled) {
    console.log(c.red("Ticket buffer is disabled: set project.tickets.enabled to true in config to use `litecode ticket`."));
    return 1;
  }

  if (sub === "new") {
    const title = arg(argv, "--title");
    const label = arg(argv, "--label") as "bug" | "feature" | "doc" | "chore" | undefined;
    const LABELS = ["bug", "feature", "doc", "chore"] as const;
    if (!title || !label) {
      console.log(c.red("ticket new requires --title <text> and --label <bug|feature|doc|chore>"));
      return 1;
    }
    if (!(LABELS as readonly string[]).includes(label)) {
      console.log(c.red(`--label must be one of ${LABELS.join(", ")}`));
      return 1;
    }
    const priority = arg(argv, "--priority") as Priority | undefined;
    const size = arg(argv, "--size") as Size | undefined;
    if (priority && !(PRIORITIES as readonly string[]).includes(priority)) {
      console.log(c.red(`--priority must be one of ${PRIORITIES.join(", ")}`));
      return 1;
    }
    if (size && !(SIZES as readonly string[]).includes(size)) {
      console.log(c.red(`--size must be one of ${SIZES.join(", ")}`));
      return 1;
    }
    if (!argv.includes("--force")) {
      const duplicate = findDuplicate(title, localDedupeCandidates(await listTickets(root, dir)));
      if (duplicate) {
        console.log(
          c.red(`Likely duplicate of local ticket ${duplicate.candidate.ref}: "${duplicate.candidate.title}" (${duplicate.reason}).`),
        );
        console.log(c.dim("If this is genuinely different work that just reads similarly, re-run with --force to create it anyway."));
        return 1;
      }
    }
    const body = arg(argv, "--body") ?? `${title}\n`;
    const ticket = await createTicket(root, dir, { title, label, body, priority, size });
    console.log(`${c.green("created")} ${ticket.path}`);
    return 0;
  }

  if (sub === "list") {
    const { tickets, errors } = await listTicketsDetailed(root, dir);
    const pendingByTicket = new Map((await listPendingAdrs(root, tickets)).map((p) => [p.ticketId, p]));
    for (const t of tickets) {
      console.log(`  ${t.status.padEnd(12)} ${t.id.padEnd(52)} ${c.dim(`${t.priority}/${t.size}`)}`);
      const pending = pendingByTicket.get(t.id);
      if (pending) {
        console.log(`    ${c.yellow("⚠ ADR en attente d'approbation")} ${pending.adrPath} — lire dans ${pending.ticketPath}`);
      }
    }
    for (const e of errors) {
      console.log(`  ${c.red("error ")} ${e.path}: ${e.error}`);
    }
    if (tickets.length === 0 && errors.length === 0) {
      console.log(c.dim(`No tickets in ${dir}. Create one with \`litecode ticket new\`.`));
    }
    return errors.length > 0 ? 1 : 0;
  }

  if (sub === "doctor") {
    const findings = await ticketDoctor(root, dir);
    if (findings.length === 0) {
      console.log(c.green(`${dir} is consistent — no malformed, misplaced, or duplicate ticket files.`));
      return 0;
    }
    for (const f of findings) {
      console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
    }
    return findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (sub === "migrate") {
    const { tickets, errors } = await listTicketsDetailed(root, dir);
    for (const e of errors) console.log(`  ${c.red("error ")} ${e.path}: ${e.error}`);
    const legacy = tickets.filter((t) => t.schemaVersion < CURRENT_SCHEMA_VERSION);
    if (legacy.length === 0) {
      console.log(c.green(`Every ticket in ${dir} is already schema v${CURRENT_SCHEMA_VERSION}.`));
      return errors.length > 0 ? 1 : 0;
    }
    // `serializeTicket` now carries an *already-parsed* unknown key through any rewrite
    // (ticket 0042) — a strict improvement for `ticket move`, though not a full round-trip
    // guarantee for every possible value (see `Ticket.extraFrontmatter`'s doc comment).
    // Migrating a v1 ticket is treated as higher-stakes here, since it's the one place a
    // legacy file gets permanently locked into schema v2: this parser is a flat
    // `key: value`-per-line reader with no notion of YAML lists/maps/comments, so a
    // hand-written non-scalar shape (`tags: [a, b]`, a value with a trailing `# comment`, a
    // nested map whose indented lines get read as bogus top-level keys) is already misread
    // by the time it reaches `t.extraFrontmatter` — writing it back out would silently bake
    // that misreading into the file, permanently, where leaving a v1 ticket alone left the
    // original (correctly YAML-shaped) file untouched instead. So this keeps the same
    // refuse-unless-`--force` gate `ticket migrate` always had for unknown keys, just built
    // from the ticket already parsed above instead of re-reading the file.
    const dropped = new Map<string, string[]>();
    for (const t of legacy) {
      console.log(`  ${c.yellow("migrate")} ${t.path} ${c.dim(`(v${t.schemaVersion} → v${CURRENT_SCHEMA_VERSION})`)}`);
      const extra = Object.keys(t.extraFrontmatter);
      if (extra.length > 0) {
        dropped.set(t.path, extra);
        console.log(`    ${c.yellow("unsure about")} unknown frontmatter key(s): ${extra.join(", ")}`);
      }
    }
    if (dropped.size > 0 && !argv.includes("--force")) {
      console.log(
        c.red(`\n${dropped.size} ticket(s) carry frontmatter keys v2 doesn't know; migrating might misread them.`) +
          c.dim(
            "\nCheck they're plain scalars (not a list/map/comment) by hand, then re-run with --force to migrate them too.",
          ),
      );
      return 1;
    }
    if (!argv.includes("--apply")) {
      console.log(c.dim(`\nDry run. Re-run with --apply to rewrite ${legacy.length} ticket(s).`));
      return 0;
    }
    for (const t of legacy) await writeTicket(root, migrateTicket(t));
    console.log(c.green(`\nMigrated ${legacy.length} ticket(s).`));
    return errors.length > 0 ? 1 : 0;
  }

  if (sub === "import-board") {
    // Config's `project.board` may already have been stripped by an earlier litecode
    // version's `upgrade --apply` (before ticket 0050 fixed `cleanConfig` to keep it
    // while `number` is set) — `--board <owner>/<number>` lets that project still run
    // the import, overriding whatever's in config. Named `--board`, not `--project`
    // (ADR 0019's ticket used `--project`): `--project <dir>` is already this CLI's
    // global "target repo directory" flag, parsed from the whole argv before subcommand
    // routing, so reusing that name here would silently hijack it instead of adding a
    // second meaning.
    const boardFlagIndex = argv.indexOf("--board");
    // `argv[boardFlagIndex + 1]` is `undefined` both when `--board` wasn't passed at all
    // and when it's the last token with no value — those must not be treated the same:
    // the latter is a malformed value (like a regex mismatch), not "flag absent", or a
    // typo'd/forgotten override would silently import from whatever's in config instead.
    const boardFlagPresent = boardFlagIndex >= 0;
    const boardFlag = boardFlagPresent ? argv[boardFlagIndex + 1] : undefined;
    let owner: string;
    let boardNumber: number;
    if (boardFlagPresent) {
      const match = boardFlag !== undefined ? /^([^/]+)\/(\d+)$/.exec(boardFlag) : null;
      if (!match) {
        console.log(c.red(`--board expects <owner>/<number>, got ${JSON.stringify(boardFlag)}.`));
        return 1;
      }
      owner = match[1]!;
      boardNumber = Number(match[2]);
    } else {
      const configuredNumber = config.project.board.number;
      if (!configuredNumber) {
        console.log(
          c.red(
            "project.board.number is not configured — nothing to import. See ADR 0019. " +
              "If it was already removed from config, pass --board <owner>/<number>.",
          ),
        );
        return 1;
      }
      boardNumber = configuredNumber;
      owner = config.project.board.owner || config.project.repo.split("/")[0]!;
    }
    const apply = argv.includes("--apply");
    let items: Awaited<ReturnType<typeof readBoardItems>>;
    try {
      items = await readBoardItems(owner, boardNumber);
    } catch (e) {
      console.log(c.red(`ticket import-board: ${(e as Error).message}`));
      return 1;
    }
    const summary = await runImportBoard(root, dir, items, apply);
    const imported = summary.entries.filter((e) => e.outcome === "imported");
    const skipped = summary.entries.filter((e) => e.outcome === "skipped");
    const failed = summary.entries.filter((e) => e.outcome === "failed");
    for (const e of imported) {
      console.log(`  ${c.green(apply ? "imported" : "would import")} ${e.importedFrom}${apply ? ` -> ${e.path}` : ""}`);
    }
    for (const e of skipped) {
      console.log(`  ${c.dim("skipped")}  ${e.importedFrom} ${c.dim(`(${e.reason})`)}`);
    }
    for (const e of failed) {
      console.log(`  ${c.red("failed")}   ${e.importedFrom} ${c.dim(`(${e.reason})`)}`);
    }
    console.log(
      `\n${c.bold("Bilan")}: ${imported.length} importé(s), ${skipped.length} ignoré(s), ${failed.length} en échec.`,
    );
    if (!apply && imported.length > 0) {
      console.log(c.dim("Simulation. Relancer avec --apply pour écrire les tickets."));
    }
    return failed.length > 0 ? 1 : 0;
  }

  if (sub === "move") {
    const id = argv[2];
    const to = argv[3] as StatusRole | undefined;
    if (!id || !to) {
      console.log(c.red("ticket move requires <id> <status>"));
      return 1;
    }
    if (!(TICKET_STATUSES as readonly string[]).includes(to)) {
      console.log(c.red(`--status must be one of ${TICKET_STATUSES.join(", ")}`));
      return 1;
    }
    const { tickets } = await listTicketsDetailed(root, dir);
    // Accepts either the full id (`0033-slug`) or just its leading `NNNN` — worktree
    // paths and ticket numbers elsewhere in this workflow are bare `NNNN`, so agents
    // following that convention would otherwise plausibly pass a number that only ever
    // matches the wrong argument.
    const exact = tickets.find((t) => t.id === id);
    const byNumber = exact ? [exact] : tickets.filter((t) => t.id.startsWith(`${id}-`));
    if (byNumber.length === 0) {
      console.log(c.red(`No ticket with id ${id} in ${dir}.`));
      return 1;
    }
    if (byNumber.length > 1) {
      console.log(c.red(`"${id}" matches more than one ticket: ${byNumber.map((t) => t.id).join(", ")}. Use the full id.`));
      return 1;
    }
    const ticket = byNumber[0]!;
    if (!isTransitionAllowed(ticket.status, to)) {
      console.log(
        c.red(`Refusing ${ticket.status} -> ${to} for ${ticket.id}: not an allowed transition.`) +
          c.dim(`\nAllowed from ${ticket.status}: ${ALLOWED_TRANSITIONS[ticket.status].join(", ") || "(none — terminal status)"}`),
      );
      return 1;
    }
    // Ticket 0035: a ticket carrying an unresolved `[À CLARIFIER]` marker never reaches
    // `planned` through this command — the one write both `dispatcher` and `triage` use to
    // move a ticket there, so gating it here covers both callers without duplicating the
    // rule in each agent's prose.
    if (to === "planned" && hasUnresolvedClarification(ticket.body)) {
      console.log(
        c.red(`Refusing ${ticket.status} -> planned for ${ticket.id}: body still carries an unresolved ${CLARIFICATION_MARKER} marker.`) +
          c.dim("\nResolve the open question and remove the marker before planning this ticket."),
      );
      return 1;
    }
    await writeTicket(root, { ...ticket, status: to });
    console.log(`${c.green("moved")} ${ticket.id}: ${ticket.status} -> ${to}`);
    return 0;
  }

  // `ticket note` (ticket 0057): the one sanctioned way to append a note to a ticket file
  // from Bash instead of an Edit/Write on the file directly. Paired with `--project`
  // (already the global root override, see `root` below), this lets an agent running
  // inside its own isolated worktree still land the note on the primary checkout's copy
  // of the ticket, on the default branch, without ever touching a relative path that
  // would otherwise resolve inside the worktree.
  if (sub === "note") {
    const id = argv[2];
    const file = arg(argv, "--file");
    if (!id || !file) {
      console.log(c.red("ticket note requires <id> --file <path>"));
      return 1;
    }
    const noteText = await Bun.file(resolve(file)).text();
    if (!noteText.trim()) {
      console.log(c.red(`ticket note: ${file} is empty`));
      return 1;
    }
    const { tickets } = await listTicketsDetailed(root, dir);
    const exact = tickets.find((t) => t.id === id);
    const byNumber = exact ? [exact] : tickets.filter((t) => t.id.startsWith(`${id}-`));
    if (byNumber.length === 0) {
      console.log(c.red(`No ticket with id ${id} in ${dir}.`));
      return 1;
    }
    if (byNumber.length > 1) {
      console.log(c.red(`"${id}" matches more than one ticket: ${byNumber.map((t) => t.id).join(", ")}. Use the full id.`));
      return 1;
    }
    const ticket = byNumber[0]!;
    await appendTicketNote(root, ticket, noteText);
    console.log(`${c.green("noted")} ${ticket.id}`);
    return 0;
  }

  usage();
  return 1;
}

/**
 * Two mutually-exclusive modes (ADR 0017): `--build` writes a committed, point-in-time
 * snapshot (`docs/dashboard.html`, browsable straight from GitHub); `--serve` starts a
 * local, read-only `Bun.serve` process that re-reads the ticket/ADR buffer on every
 * request instead. Passing both, or neither, is a usage error (exit 1) — this replaces the
 * old "dashboard requires --build ..." message; anything matching that old text now breaks
 * (documented breaking change, see ADR 0017 point 5 / release notes).
 */
async function cmdDashboard(root: string, argv: string[]): Promise<number> {
  const wantsBuild = argv.includes("--build");
  const wantsServe = argv.includes("--serve");

  if (wantsBuild && wantsServe) {
    console.log(c.red("dashboard: --build and --serve are mutually exclusive, pass only one"));
    return 1;
  }
  if (!wantsBuild && !wantsServe) {
    usage();
    return 1;
  }

  const { config } = await loadConfig(root);
  const dir = config.project.tickets.dir;

  if (wantsServe) {
    const portArg = arg(argv, "--port");
    const hostArg = arg(argv, "--host");
    const port = portArg ? Number(portArg) : DEFAULT_PORT;
    if (portArg && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
      console.log(c.red(`dashboard: invalid --port '${portArg}'`));
      return 1;
    }

    const configAllowHosts = config.project.dashboard?.allowedHosts ?? [];
    const cliAllowHosts = repeatedArg(argv, "--allow-host");
    const allowHosts = [...configAllowHosts, ...cliAllowHosts];
    const wildcard = allowHosts.find((h) => h.includes("*"));
    if (wildcard) {
      // Named its actual source (config vs --allow-host): a wildcard from litecode.config.json's
      // project.dashboard.allowedHosts would otherwise point the operator at a CLI flag they
      // never passed (bug-hunter finding on this PR).
      const source = cliAllowHosts.includes(wildcard) ? "--allow-host" : "project.dashboard.allowedHosts";
      console.log(c.red(`dashboard: '${wildcard}' (from ${source}) is a wildcard, which is never accepted (DNS-rebinding protection)`));
      return 1;
    }

    try {
      await startDashboardServer(root, dir, { port, host: hostArg ?? DEFAULT_HOST, allowHosts });
    } catch (e) {
      console.log(c.red(`dashboard: ${(e as Error).message}`));
      return 1;
    }
    // Stays alive: startDashboardServer registers its own SIGINT handler (exit 0) and
    // Bun.serve keeps the process running until then.
    return new Promise<number>(() => {});
  }

  const outArg = arg(argv, "--out");
  const outPath = resolve(root, outArg ?? "docs/dashboard.html");

  const data = await buildDashboard(root, dir);
  const html = renderDashboard(data);
  await mkdir(dirname(outPath), { recursive: true });
  await Bun.write(outPath, html);

  console.log(`${c.green("built")} ${outPath} (${data.total} ticket(s), ${data.blockedTickets.length} bloqué(s))`);
  if (data.loadErrors.length > 0) {
    console.log(c.yellow(`  ${data.loadErrors.length} fichier(s) en échec de lecture — voir \`litecode ticket doctor\`.`));
  }
  if (data.adrLoadErrors.length > 0) {
    console.log(c.yellow(`  ${data.adrLoadErrors.length} ADR(s) en échec de lecture.`));
  }
  return 0;
}

/**
 * Never trusts the report on its own: every checkable claim is compared against the repo,
 * the PR and the ticket file (ticket 0017). Errors mean the report contradicts reality;
 * warnings mean a claim couldn't be checked, or something looks off but may be benign.
 */
async function cmdVerifyReport(root: string, argv: string[]): Promise<number> {
  const file = arg(argv, "--file");
  if (!file && process.stdin.isTTY) {
    console.log(c.red("verify-report needs a report: pass --file <path>, or pipe the report on stdin"));
    return 1;
  }
  const text = file ? await Bun.file(resolve(root, file)).text() : await Bun.stdin.text();
  const { config } = await loadConfig(root);

  const parsed = parseReport(text);
  const findings: ReportFinding[] =
    "error" in parsed
      ? [parsed.error]
      : await verifyReport(
          parsed.report,
          realProbes({
            root,
            repo: config.project.repo,
            ticketsDir: config.project.tickets.dir,
          }),
          { repo: config.project.repo },
        );
  const errors = findings.filter((f) => f.severity === "error").length;

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ok: errors === 0, findings }, null, 2));
  } else if (findings.length === 0) {
    console.log(c.green("Report matches the repo, the PR and the ticket buffer."));
  } else {
    for (const f of findings) console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
  }
  return errors === 0 ? 0 : 1;
}

/** A ticket is named by its id (`0030-slug`) or its number (`0030`, `30`, `#0030`), like `ticketStatus`. */
async function findTicketByRef(root: string, dir: string, ref: string) {
  const { tickets } = await listTicketsDetailed(root, dir);
  const bare = ref.replace(/^#/, "");
  const key = /^\d{1,4}$/.test(bare) ? bare.padStart(4, "0") : bare;
  return tickets.find((t) => t.id === key || t.id.startsWith(`${key}-`));
}

async function cmdResume(root: string, argv: string[]): Promise<number> {
  const ref = argv[1];
  if (!ref) {
    console.log(c.red("resume needs a ticket: `bunx litecodeagent resume <ticket>`"));
    return 1;
  }
  const { config } = await loadConfig(root);
  const ticket = await findTicketByRef(root, config.project.tickets.dir, ref);
  if (!ticket) {
    console.log(c.red(`no ticket found for '${ref}'`));
    return 1;
  }

  const result = await resumeState(
    ticket.body,
    realResumeProbes({ root, repo: config.project.repo, ticketsDir: config.project.tickets.dir }),
  );

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ticket: ticket.id, ...result }, null, 2));
    return result.kind === "no-journal" || result.findings.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (result.kind === "no-journal") {
    console.log(c.yellow(`${ticket.id}: no progress journal found on this ticket — nothing to resume from.`));
    console.log(c.dim("Run `bunx litecodeagent doctor` to check for orphaned worktrees/branches instead."));
    return 1;
  }

  console.log(c.bold(`${ticket.id}`));
  console.log(`  step:     ${result.entry.step}`);
  if (result.entry.worktree) console.log(`  worktree: ${result.entry.worktree}`);
  if (result.entry.branch) console.log(`  branch:   ${result.entry.branch}`);
  if (result.entry.commit) console.log(`  commit:   ${result.entry.commit}`);
  if (result.entry.pr) console.log(`  pr:       ${result.entry.pr}`);
  if (result.findings.length > 0) {
    console.log("");
    for (const f of result.findings) console.log(`  ${f.severity === "error" ? c.red("error") : c.yellow("warn ")} ${f.message}`);
  }
  console.log(`\n${c.bold(result.findings.some((f) => f.severity === "error") ? c.red("=>") : c.green("=>"))} ${result.resumeAt}`);
  return result.findings.some((f) => f.severity === "error") ? 1 : 0;
}

/**
 * One command from "new release available" to "project up to date" (ADR 0016). A legacy
 * git-clone install pulls itself first and hands over to a fresh process, so the project
 * is migrated by the code it just fetched rather than by the code already running.
 */
async function cmdUpgrade(root: string, argv: string[]): Promise<number> {
  if (!argv.includes("--no-self-update")) {
    let self: Awaited<ReturnType<typeof upgrade>>;
    try {
      self = await upgrade(KIT_ROOT);
    } catch (e) {
      console.log(c.red(`Could not update litecodeagent itself (${KIT_ROOT}):\n${(e as Error).message}`));
      console.log(c.dim("Fix that, or re-run with --no-self-update to upgrade this project with the version you have."));
      return 1;
    }
    if (self.updated) {
      for (const line of self.log) console.log(line ? `  ${line}` : "");
      console.log(c.dim("\nContinuing with the updated version…\n"));
      const proc = Bun.spawn([process.execPath, join(KIT_ROOT, "src", "cli.ts"), ...argv, "--no-self-update"], {
        cwd: process.cwd(),
        stdio: ["inherit", "inherit", "inherit"],
      });
      return await proc.exited;
    }
  }

  if (!(await Bun.file(join(root, CONFIG_FILENAME)).exists())) {
    console.log(`No ${CONFIG_FILENAME} in ${root}: nothing to upgrade here. Run \`bunx litecodeagent init\` to set up a project.`);
    return 0;
  }

  const { config } = await loadConfig(root);
  const plans = await planUpgrade({ root, config, packsRoot: PACKS_ROOT, litecodeVersion: VERSION });

  console.log(`${c.bold("Project")}  ${root}`);
  console.log(`${c.bold("Release")}  ${VERSION}\n`);
  for (const plan of plans) {
    if (plan.changes.length === 0 && plan.skipped.length === 0) continue;
    console.log(c.bold(plan.title));
    for (const change of plan.changes) {
      console.log(`  ${c.green("•")} ${change.summary}`);
      for (const detail of change.details ?? []) console.log(c.dim(`      ${detail}`));
    }
    for (const skip of plan.skipped) console.log(`  ${c.yellow("skip")} ${skip.summary} ${c.dim(`— ${skip.reason}`)}`);
  }

  // Exit code: 0 only when the project ends up fully current. Anything left pending —
  // a plan not applied, or items skipped that need a human — is 1, so CI can tell.
  const attention = () => {
    console.log(c.yellow('Some items were left alone and need your attention — see "skip" above.'));
    return 1;
  };

  if (!hasChanges(plans)) {
    if (hasSkips(plans)) return attention();
    console.log(c.green("Already up to date — nothing to change."));
    return 0;
  }

  if (!argv.includes("--yes") && !argv.includes("-y")) {
    if (!isInteractive()) {
      console.log(c.yellow("\nNot a terminal, so nothing was applied. Re-run with --yes to apply this plan."));
      return 1;
    }
    console.log("");
    if (!(await confirm("Apply these changes?", false))) {
      console.log(c.dim("Nothing changed."));
      return 1;
    }
  }

  await applyUpgrade(plans, () => {});
  const applied = plans.reduce((n, p) => n + p.changes.length, 0);
  console.log(c.green(`\nUpgraded: ${applied} change(s) applied.`));
  if (plans.some((p) => p.id === "tickets" && p.changes.length > 0)) {
    console.log(c.dim("Migrated tickets are uncommitted: review and commit them like any other change."));
  }
  return hasSkips(plans) ? attention() : 0;
}

const argv = process.argv.slice(2);
// A `--project` with no usable value must never fall back to the cwd: an isolated
// implementer passing an unset/empty path would otherwise write its ticket changes into
// its own worktree copy while reporting success (ticket 0057, bug-hunter finding).
const projectArg = arg(argv, "--project");
if (argv.some((a) => a.startsWith("--project="))) {
  console.log(c.red("--project takes its value as a separate argument: --project <dir>"));
  process.exit(1);
}
if (argv.includes("--project") && (!projectArg?.trim() || projectArg.startsWith("--"))) {
  console.log(c.red("--project requires a non-empty directory path"));
  process.exit(1);
}
const root = resolve(projectArg ?? process.cwd());

try {
  const code = await (async () => {
    switch (argv[0]) {
      case "--version":
      case "-v":
        console.log(VERSION);
        return 0;
      case "--help":
      case "-h":
        usage();
        return 0;
      case "setup": return cmdSetup(root, argv);
      case "init": {
        const packsArg = arg(argv, "--packs");
        const yes = argv.includes("--yes") || argv.includes("-y");
        const path = await init(root, {
          packs: packsArg ? packsArg.split(",").map((s) => s.trim()) : undefined,
          targets: parseTargets(arg(argv, "--targets")),
          yes,
          packsRoot: PACKS_ROOT,
        });
        console.log(`\n${summarize(path, !yes && isInteractive())}`);
        return 0;
      }
      case "upgrade": return cmdUpgrade(root, argv);
      case "targets": return cmdTargets(root);
      case "packs": return cmdPacks();
      case "install": return cmdInstall(root, argv);
      case "status": return cmdStatus(root);
      case "config": return cmdConfig(root, argv);
      case "run": return cmdRun(root, argv);
      case "ticket": return cmdTicket(root, stripFlag(argv, "--project"));
      case "guard-branch": return cmdGuardBranch(root, argv);
      case "dashboard": return cmdDashboard(root, argv);
      case "verify-report": return cmdVerifyReport(root, argv);
      case "doctor": return cmdDoctor(root);
      case "resume": return cmdResume(root, argv);
      default: usage(); return argv[0] ? 1 : 0;
    }
  })();
  process.exit(code);
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error(c.yellow(`\n${err.message}`));
    process.exit(2);
  }
  console.error(c.red(`\n${(err as Error).message}`));
  process.exit(1);
}
