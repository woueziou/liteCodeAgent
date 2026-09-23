import { resolve, join } from "node:path";
import { CONFIG_FILENAME, TARGETS, TARGET_INFO, type InstallTarget } from "./config.ts";
import { detect, extractConventions, type Detected } from "./detect.ts";
import { listPacks, loadPack } from "./packs.ts";
import { ask, askList, confirm, heading, isInteractive, multiSelect, note, color } from "./prompt.ts";

type Angle = {
  name: string;
  covers: string;
  triggeredBy: string;
  skills: string[];
  always?: boolean;
};

/**
 * Angles worth offering, gated on what the repo actually contains. An angle nobody can
 * trigger is pure cost: it shows up in every panel-selector prompt and never fires.
 */
/**
 * A project that already owns a stack-specific expert as a local overlay (say
 * `orpc-expert`) should have it wired in automatically — that skill is exactly what the
 * schema/contract angles need, and asking the human to remember it is how it gets missed.
 */
function apiExpert(d: Detected, available: Set<string>): string[] {
  const candidate = d.stack.api ? `${d.stack.api.toLowerCase()}-expert` : undefined;
  return candidate && available.has(candidate) ? [candidate] : [];
}

function candidateAngles(d: Detected, skillsAvailable: Set<string>): (Angle & { selected: boolean })[] {
  const keep = (...skills: string[]) => skills.filter((s) => skillsAvailable.has(s));
  const api = apiExpert(d, skillsAvailable);
  const { stack } = d;
  return [
    {
      name: "correctness",
      covers: "Does the change actually solve the stated problem, and what edge cases does it miss.",
      triggeredBy: "always — every non-trivial change gets this angle",
      skills: keep("critique-expert"),
      always: true,
      selected: true,
    },
    {
      name: "schema",
      covers: `${stack.orm ?? "Database"} schema/migration implications and backward compatibility of existing rows.`,
      triggeredBy: "the change adds, alters or removes a database field/table, or needs a migration",
      skills: [...api, ...keep("typescript-expert")],
      selected: Boolean(stack.orm),
    },
    {
      name: "contract",
      covers: `Breaking changes for consumers of ${stack.api ? `an ${stack.api} procedure` : "a public endpoint"} or an exported type.`,
      triggeredBy: "the change touches an endpoint signature, a response shape, or an exported type",
      skills: [...api, ...keep("typescript-expert")],
      selected: Boolean(stack.api) || stack.typescript,
    },
    {
      name: "auth",
      covers: "Authentication/authorization correctness and caller-supplied identity trust boundaries — check BOLA first.",
      triggeredBy: "the change touches auth middleware, permission gating, or any fetch-by-id handler",
      skills: keep("security-expert"),
      selected: stack.hasAuth,
    },
    {
      name: "operability",
      covers: "Logging, error handling and observability — how failures get diagnosed in production.",
      triggeredBy: "the change affects error paths, logging, or external-call failure handling",
      skills: [...api, ...keep("frontend-expert")],
      selected: true,
    },
  ];
}

function candidateDomains(d: Detected, available: Set<string>): { match: string; skills: string[] }[] {
  const has = (s: string) => available.has(s);
  const out: { match: string; skills: string[] }[] = [];
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
  if (has("design-expert")) out.push({ match: "visual layout as part of the ticket", skills: ["design-expert"] });
  if (has("mobile-expert")) {
    out.push({
      match: "a small viewport or touch interaction",
      skills: ["mobile-expert", "mobile-ui-ux-expert", "mobile-design-expert"].filter(has),
    });
  }
  if (has("security-expert")) {
    out.push({
      match: "auth, user input validation, or an external integration",
      skills: ["security-expert"],
    });
  }
  return out;
}

/**
 * agentSkills is mechanical: each agent gets the experts reachable from the angles and
 * domains already chosen. Asking a human to maintain this list by hand is how it drifts
 * into naming skills that no installed pack provides.
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

export type InitOptions = { packs?: string[]; targets?: InstallTarget[]; yes: boolean; packsRoot: string };

export async function init(projectRoot: string, opts: InitOptions): Promise<string> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  if (await Bun.file(path).exists()) throw new Error(`${CONFIG_FILENAME} already exists at ${path}`);

  const d = await detect(projectRoot);
  const interactive = opts.yes ? false : isInteractive();

  let targets = opts.targets ?? [...TARGETS];
  if (interactive && !opts.targets) {
    heading("AI coding tools");
    note("LiteCodeAgent can install native agents and its planning workflow into several tools at once.");
    targets = await multiSelect(
      "Which tools should receive LiteCodeAgent?",
      TARGETS.map((target) => ({
        label: TARGET_INFO[target].label,
        hint: `${TARGET_INFO[target].description} \u2192 ${TARGET_INFO[target].directory}`,
        value: target,
        selected: targets.includes(target),
      })),
    );
    if (targets.length === 0) throw new Error("Choose at least one AI coding tool.");
  }

  // --- packs -------------------------------------------------------------------------
  const allPacks = await listPacks(opts.packsRoot);
  let packs = opts.packs ?? (d.stack.react ? ["core", "web"] : ["core"]);
  if (interactive && !opts.packs) {
    heading("Packs");
    note(`Detected: ${d.stack.framework ?? "no web framework"}${d.stack.orm ? `, ${d.stack.orm}` : ""}${d.stack.api ? `, ${d.stack.api}` : ""}`);
    packs = await multiSelect(
      "Which packs do you want?",
      await Promise.all(
        allPacks.map(async (name) => {
          const pack = await loadPack(opts.packsRoot, name);
          return { label: name, value: name, hint: pack.manifest.description, selected: packs.includes(name) };
        }),
      ),
    );
    if (!packs.includes("core")) packs = ["core", ...packs];
  }

  const packSkills = new Set<string>();
  for (const name of packs) {
    for (const file of (await loadPack(opts.packsRoot, name)).files) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.rel);
      if (m?.[1]) packSkills.add(m[1]);
    }
  }
  const available = new Set([...packSkills, ...d.localSkills]);

  // --- project basics ----------------------------------------------------------------
  let repo = d.repo ?? "";
  let defaultBranch = d.defaultBranch;
  let checkCommand = d.checkCommand ?? "";
  let typecheckCommands = d.typecheckCommands;
  let adrDir: string | null = d.adrDir ?? "docs/decisions";
  let name = d.name;
  let language = "";

  if (interactive) {
    heading("Project");
    name = await ask("Project name", name, { required: true });
    repo = await ask("GitHub repo (owner/name)", repo, { required: true });
    defaultBranch = await ask("Default branch", defaultBranch, { required: true });
    checkCommand = await ask(
      "Command that must pass before an agent calls work done",
      checkCommand || undefined,
      { required: true },
    );
    const tc = await ask(
      "Type-check commands, comma-separated (blank if none)",
      typecheckCommands.join(", ") || undefined,
    );
    typecheckCommands = tc ? tc.split(",").map((s) => s.trim()).filter(Boolean) : [];
    adrDir = (await confirm(`Record architecture decisions as ADRs${d.adrDir ? ` in ${d.adrDir}` : ""}?`, Boolean(d.adrDir)))
      ? await ask("ADR directory", d.adrDir ?? "docs/decisions", { required: true })
      : null;
    // Free text, no BCP-47 validation, no auto-detection — there is no `language` field on
    // `Detected` to default from. Blank (the default answer) omits the key entirely, so a
    // skipped question renders byte-identical to a config predating this feature.
    language = await ask(
      "Working language for agent prose, e.g. French (blank to keep agents in English)",
      undefined,
    );
  }

  // --- conventions -------------------------------------------------------------------
  let conventions: string[] = [];
  if (interactive) {
    heading("Conventions");
    note("These are the rules implementer and reviewer are held to — the highest-leverage part of this file.");
    const found = d.conventionsFile ? await extractConventions(projectRoot, d.conventionsFile) : [];
    if (found.length > 0) {
      note(`Found ${found.length} candidate rules in ${d.conventionsFile}.`);
      conventions = await multiSelect(
        "Which ones should the agents follow?",
        found.map((text) => ({
          label: text.length > 100 ? `${text.slice(0, 100)}…` : text,
          value: text,
          selected: true,
        })),
      );
    } else {
      conventions = await askList("House rules", "One rule per line");
    }
  }

  // --- trust boundaries --------------------------------------------------------------
  let trustBoundaries: string[] = [];
  if (interactive) {
    heading("Trust boundaries");
    note("What a security review must assume about this codebase. Blank line to skip.");
    trustBoundaries = await askList("Trust boundaries", "One per line");
  }

  // --- angles / domains --------------------------------------------------------------
  const candidates = candidateAngles(d, available);
  let angles: Angle[] = candidates.filter((a) => a.selected).map(({ selected: _s, ...a }) => a);
  if (interactive) {
    heading("Debate angles");
    note("Each selected angle is argued in parallel by its own agent on every non-trivial change.");
    const picked = await multiSelect(
      "Which angles apply to this codebase?",
      candidates.map((a) => ({
        label: a.name,
        value: a.name,
        hint: a.covers.length > 70 ? `${a.covers.slice(0, 70)}…` : a.covers,
        selected: a.selected,
      })),
    );
    angles = candidates
      .filter((a) => picked.includes(a.name) || a.always)
      .map(({ selected: _s, ...a }) => a);
  }

  const domains = candidateDomains(d, available);
  const agentSkills = deriveAgentSkills(angles, domains, available);

  // --- web pack ----------------------------------------------------------------------
  let web: {
    appDir: string;
    framework: string;
    apiClient: string;
    typeSourceOfTruth: string;
    typecheck: string;
    styling: string;
  } | undefined;
  if (packs.includes("web")) {
    let appDir = d.stack.webAppDir ?? ".";
    let framework = d.stack.framework ?? "React";
    let apiClient = "TODO: how the API client is produced and how call sites use it";
    let typeSourceOfTruth = d.stack.orm
      ? `the ${d.stack.orm} schema`
      : "TODO: where shared types/schemas are generated from";
    let styling = d.stack.styling ?? "CSS";

    if (interactive) {
      heading("Web pack");
      note("These values are injected into the web experts; setup cannot render vague TODO instructions.");
      appDir = await ask("Web application directory", appDir, { required: true });
      framework = await ask("Web framework", framework, { required: true });
      apiClient = await ask(
        "How is the API client produced and used?",
        d.stack.api ? `the ${d.stack.api} client` : undefined,
        { required: true },
      );
      typeSourceOfTruth = await ask(
        "Source of truth for shared types and schemas",
        d.stack.orm ? `the ${d.stack.orm} schema` : undefined,
        { required: true },
      );
      styling = await ask("Styling system", styling, { required: true });
    }

    web = {
      appDir,
      framework,
      apiClient,
      typeSourceOfTruth,
      typecheck: typecheckCommands[0] ?? checkCommand,
      styling,
    };
  }

  // An undetectable field becomes an explicit TODO rather than an empty string: the config
  // guard then names it precisely, instead of a schema error surfacing three commands later.
  const config = {
    packs,
    targets,
    outDir: ".claude",
    target: "claude-code",
    tiers: { fast: "haiku", balanced: "sonnet", reasoning: "opus" },
    project: {
      name,
      repo: repo || "TODO-owner/TODO-repo",
      defaultBranch,
      checkCommand: checkCommand || "TODO: the command that must pass before work is called done",
      typecheckCommands,
      worktreeRoot: "../worktrees",
      adrDir,
      conventions,
      trustBoundaries,
      lessons: [],
      angles,
      domains,
      agentSkills,
      ...(language ? { language } : {}),
      ...(web ? { web } : {}),
    },
  };

  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

export function summarize(path: string, interactive: boolean): string {
  const lines = [`${color.green("Wrote")} ${path}`];
  if (!interactive) {
    lines.push(
      color.dim("Non-interactive: fields that could not be detected were left as TODO."),
      color.dim("Fill them in, then run `bunx litecodeagent setup`."),
    );
  } else {
    lines.push(
      "",
      `Review it, then: ${color.bold("bunx litecodeagent setup")} ${color.dim("(dry run)")}`,
    );
  }
  return lines.join("\n");
}
