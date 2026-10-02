import { resolve } from "node:path";
import { CONFIG_FILENAME, TARGET_INFO, type InstallTarget } from "./config.ts";
import { detect, detectTargets, type Detected } from "./detect.ts";
import { loadPack } from "./packs.ts";
import { askList, heading, isInteractive, note, color } from "./prompt.ts";

type Angle = {
  name: string;
  covers: string;
  triggeredBy: string;
  skills: string[];
  always?: boolean;
};

type Rule = { match: string; skills: string[] };

/**
 * A project that already owns a stack-specific expert as a local overlay (say
 * `orpc-expert`) should have it wired in automatically: asking the human to remember it is
 * how it gets missed.
 */
function apiExpert(d: Detected, available: Set<string>): string[] {
  const candidate = d.stack.api ? `${d.stack.api.toLowerCase()}-expert` : undefined;
  return candidate && available.has(candidate) ? [candidate] : [];
}

/** Routing rules deduced from the stack. A rule is proposed only when the stack calls for it. */
function candidateDomains(d: Detected, available: Set<string>): Rule[] {
  const has = (s: string) => available.has(s);
  const out: Rule[] = [];
  const backend = [...apiExpert(d, available), ...["typescript-expert"].filter(has)];
  if (d.stack.api && backend.length) {
    out.push({ match: `backend logic (${d.stack.api})`, skills: backend });
  }
  if (d.stack.webAppDir && has("frontend-expert")) {
    out.push({
      match: `\`${d.stack.webAppDir}\` component/flow work`,
      skills: ["frontend-expert", "ui-ux-expert"].filter(has),
    });
  }
  if (d.stack.webAppDir && has("design-expert")) {
    out.push({ match: "visual layout as part of the ticket", skills: ["design-expert"] });
  }
  if ((d.stack.hasAuth || d.stack.api) && has("security-expert")) {
    out.push({
      match: "auth, user input validation, or an external integration",
      skills: ["security-expert"],
    });
  }
  return out;
}

/** The only question the init asks. It avoids the word "domain": that is our term, not theirs. */
export const RULES_QUESTION = "When a ticket touches…, which guides should the agent read?";

export type RulesQuestion = { question: string; proposed: Rule[] };

const RULES_HELP =
  "Enter alone accepts the rules above. Otherwise one line each: `N: when => guide, guide` edits rule N, " +
  "`when => guide, guide` adds one, `-N` removes rule N, `skip` keeps none.";

type Applied = { rules: Rule[] } | { error: string };

/**
 * Applies the typed lines to the proposed rules. Numbers always refer to the list as
 * proposed, so a removal does not shift the numbering of a later edit.
 */
export function applyRuleAnswer(proposed: Rule[], lines: string[], available: Set<string>): Applied {
  if (lines.some((l) => l.trim().toLowerCase() === "skip")) return { rules: [] };
  const rules: (Rule | null)[] = [...proposed];
  const added: Rule[] = [];
  const parse = (text: string): Rule | string => {
    const [match, list] = text.split("=>").map((part) => part.trim());
    const skills = (list ?? "").split(",").map((skill) => skill.trim()).filter(Boolean);
    if (!match || skills.length === 0) return `"${text}": write it as: when => guide, guide`;
    const unknown = skills.filter((skill) => !available.has(skill));
    if (unknown.length > 0) return `"${text}": no such guide: ${unknown.join(", ")}`;
    return { match, skills };
  };
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const remove = /^-\s*(\d+)$/.exec(line);
    const edit = /^(\d+)\s*:\s*(.+)$/.exec(line);
    if (remove || edit) {
      const index = Number((remove ?? edit)![1]) - 1;
      if (rules[index] === undefined || rules[index] === null) {
        return { error: `"${line}": there is no rule ${index + 1}` };
      }
      if (remove) {
        rules[index] = null;
        continue;
      }
      const rule = parse(edit![2]!);
      if (typeof rule === "string") return { error: rule };
      rules[index] = rule;
      continue;
    }
    const rule = parse(line);
    if (typeof rule === "string") return { error: rule };
    added.push(rule);
  }
  return { rules: [...rules.filter((r): r is Rule => r !== null), ...added] };
}

/** The real question, on a terminal: shows the proposals, then reads lines until a blank one. */
async function askRulesOnTerminal({ question, proposed }: RulesQuestion): Promise<string[]> {
  heading("Routing");
  if (proposed.length > 0) {
    note("Deduced from your stack:");
    proposed.forEach((rule, i) => note(`  ${i + 1}. ${rule.match} → ${rule.skills.join(", ")}`));
  } else {
    note("Nothing was deduced from your stack. Write at least one rule, or type `skip`.");
  }
  note(RULES_HELP);
  return askList(question, "One line per change");
}

/**
 * Per-agent skill lists derived from angles and domains. No longer written by `init`
 * (skills load on demand through the routing rules); kept for `config doctor --fix`.
 */
export function deriveAgentSkills(
  angles: Angle[],
  domains: { skills: string[] }[],
  available: Set<string>,
): Record<string, string[]> {
  const has = (s: string) => available.has(s);
  const angleSkills = [...new Set(angles.flatMap((a) => a.skills))].filter(has);
  const domainSkills = [...new Set(domains.flatMap((d) => d.skills))].filter(has);
  const attribution = ["agent-attribution"].filter(has);
  const critique = ["critique-expert"].filter(has);

  return {
    "debate-angle": [...new Set([...angleSkills, ...critique])],
    planner: domainSkills.filter((s) => s !== "security-expert"),
    implementer: [...new Set([...attribution, ...domainSkills])],
    reviewer: [...new Set([...attribution, ...domainSkills, ...critique])],
    triage: [],
    dispatcher: [],
    tracker: attribution,
  };
}

export type InitOptions = {
  packs?: string[];
  targets?: InstallTarget[];
  yes: boolean;
  packsRoot: string;
  /** Force or forbid the question; defaults to "a terminal, and no --yes". */
  interactive?: boolean;
  /** How the single question is answered; the terminal by default. Returns the lines as typed. */
  answerRules?: (q: RulesQuestion) => Promise<string[]>;
};

export async function init(projectRoot: string, opts: InitOptions): Promise<string> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  if (await Bun.file(path).exists()) throw new Error(`${CONFIG_FILENAME} already exists at ${path}`);

  const d = await detect(projectRoot);
  const interactive = opts.interactive ?? (opts.yes ? false : isInteractive());

  const targets = opts.targets ?? (await detectTargets(projectRoot));
  const packs = [...(opts.packs ?? (d.stack.react ? ["core", "web"] : ["core"]))];
  if (!packs.includes("core")) packs.unshift("core");

  const packSkills = new Set<string>();
  for (const name of packs) {
    for (const file of (await loadPack(opts.packsRoot, name)).files) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.rel);
      if (m?.[1]) packSkills.add(m[1]);
    }
  }
  const available = new Set([...packSkills, ...d.localSkills]);

  // --- the one question: routing rules -----------------------------------------------
  const proposed = candidateDomains(d, available);
  let domains = proposed;
  if (interactive) {
    const answer = opts.answerRules ?? askRulesOnTerminal;
    for (;;) {
      const lines = (await answer({ question: RULES_QUESTION, proposed })).filter((l) => l.trim());
      if (lines.length === 0) {
        if (proposed.length > 0) break;
        note("At least one rule is needed, or type `skip` to go without.");
        continue;
      }
      const applied = applyRuleAnswer(proposed, lines, available);
      if ("error" in applied) {
        note(applied.error);
        continue;
      }
      domains = applied.rules;
      break;
    }
  }

  // --- web pack: detected, never asked -----------------------------------------------
  const web = packs.includes("web")
    ? {
        appDir: d.stack.webAppDir ?? ".",
        framework: d.stack.framework ?? "React",
        apiClient: d.stack.api ? `the ${d.stack.api} client` : "the project's API client",
        typeSourceOfTruth: d.stack.orm ? `the ${d.stack.orm} schema` : "the project's shared type definitions",
        typecheck: d.typecheckCommands[0] ?? d.checkCommand ?? "",
        styling: d.stack.styling ?? "CSS",
      }
    : undefined;

  // Minimal on purpose: everything not written here takes its default, and `litecode config
  // set` changes it. A value that could not be detected is left out, not faked: the agents
  // that need it refuse and name the command that fills it.
  const config = {
    packs,
    targets,
    project: {
      name: d.name,
      ...(d.repo ? { repo: d.repo } : {}),
      defaultBranch: d.defaultBranch,
      ...(d.checkCommand ? { checkCommand: d.checkCommand } : {}),
      typecheckCommands: d.typecheckCommands,
      domains,
      ...(web ? { web } : {}),
    },
  };

  printSummary(config);
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

/** What is about to be written, shown before it is. */
function printSummary(config: {
  packs: string[];
  targets: InstallTarget[];
  project: {
    name: string;
    repo?: string;
    defaultBranch: string;
    checkCommand?: string;
    typecheckCommands: string[];
    domains: Rule[];
  };
}): void {
  const { project } = config;
  const out: string[] = [
    "",
    color.bold("Summary"),
    `  project    ${project.name} (branch ${project.defaultBranch}${project.repo ? `, ${project.repo}` : ""})`,
    `  tools      ${config.targets.map((t) => `${TARGET_INFO[t].label} (${t})`).join(", ")}`,
    `  packs      ${config.packs.join(", ")}`,
    `  check      ${project.checkCommand ?? "not found"}`,
  ];
  if (project.typecheckCommands.length) out.push(`  type-check ${project.typecheckCommands.join(", ")}`);
  out.push(project.domains.length ? "  rules" : "  rules      none");
  for (const rule of project.domains) out.push(`    ${rule.match} → ${rule.skills.join(", ")}`);
  if (!project.checkCommand) {
    out.push(color.dim('  No check command found: set it with `litecode config set project.checkCommand "<command>"`.'));
  }
  if (!project.repo) {
    out.push(color.dim("  No GitHub repository found: set it with `litecode config set project.repo <owner/name>`."));
  }
  process.stdout.write(`${out.join("\n")}\n`);
}

export function summarize(path: string, interactive: boolean): string {
  return [
    `${color.green("Wrote")} ${path}`,
    "",
    `Next: ${color.bold("bunx litecodeagent setup")}${interactive ? color.dim(" (dry run first)") : ""}`,
  ].join("\n");
}
