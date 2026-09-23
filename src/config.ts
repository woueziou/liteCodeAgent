import { z } from "zod";
import { resolve } from "node:path";

/**
 * The per-project config consumed by `litecode install`. Everything a pack file
 * can interpolate lives under `project`; nothing project-specific is allowed to
 * be hardcoded inside a pack.
 */

const AngleSchema = z.object({
  name: z.string(),
  /** One line: what this angle argues about. Rendered into panel-selector + debate-angle. */
  covers: z.string(),
  /** One line: the concrete signal that makes this angle relevant (paths, symbols). */
  triggeredBy: z.string(),
  /** Expert skills debate-angle should load when arguing this angle. */
  skills: z.array(z.string()).default([]),
  /** Always select this angle, regardless of what the request touches. */
  always: z.boolean().default(false),
});

const DomainSchema = z.object({
  /** Human-readable description of what the change touches, e.g. "apps/web component work". */
  match: z.string(),
  skills: z.array(z.string()).min(1),
});

const SizeRuleSchema = z.object({
  size: z.enum(["trivial", "small", "medium", "large"]),
  /** Project-specific signals that put a change in this bucket. */
  signals: z.array(z.string()).min(1),
});

/**
 * Vestigial: `board init`/`board doctor` were removed once the local ticket buffer became
 * the sole source of truth for pipeline state (see the local-first-tickets epic). Nothing
 * in the runtime reads any field of this schema any more. It stays optional, with no
 * required fields, purely so a `litecode.config.json` committed before that removal still
 * parses without a migration — a fresh `litecode init` no longer writes this key at all.
 */
const BoardSchema = z.object({
  enabled: z.boolean().default(true),
  owner: z.string().default(""),
  /** GitHub Project (v2) number, e.g. 1. Omit when the board has not been provisioned yet. */
  number: z.number().int().positive().optional(),
  dataFile: z.string().default(".claude/data/board.json"),
  itemIdCache: z.string().default(".claude/data/github-project-item-ids.json"),
});

/**
 * Optional with a default, unlike `board`: `board` was required from day one, so every
 * config that has ever parsed already carries it. `tickets` is new — a `litecode.config.json`
 * committed before this feature existed has no `tickets` key at all, and making it required
 * would break that config outright on upgrade. See ADR 0001.
 */
const TicketsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Where the local ticket buffer lives, relative to the repo root. */
  dir: z.string().default("docs/tickets"),
});

export const ProjectSchema = z.object({
  name: z.string(),
  /** owner/repo */
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "expected owner/repo"),
  defaultBranch: z.string().default("main"),

  /** The command that must pass before any agent calls work done. */
  checkCommand: z.string(),
  /** Extra verification commands (type-checks etc.), run when types moved. */
  typecheckCommands: z.array(z.string()).default([]),

  /** Where implementer puts per-ticket worktrees, relative to the repo checkout. */
  worktreeRoot: z.string().default("../worktrees"),
  /** Where ADRs live, or null if this project does not use ADRs. */
  adrDir: z.string().nullable().default("docs/decisions"),

  /** Free prose injected into implementer/reviewer/planner: this project's code conventions. */
  conventions: z.array(z.string()).default([]),
  /** Free prose injected into security-expert: this project's trust boundaries. */
  trustBoundaries: z.array(z.string()).default([]),
  /**
   * Precedents: incidents this project already lived through, injected into implementer
   * so the lesson travels with the agent instead of living only in a postmortem.
   */
  lessons: z.array(z.string()).default([]),

  /**
   * Skills preloaded per agent, keyed by agent name. This is what the target harness's
   * `skills:` frontmatter is rendered from — packs never hardcode a skill list, since
   * which experts exist depends on which packs the project installed.
   */
  agentSkills: z.record(z.string(), z.array(z.string())).default({}),

  /** Which debate angles exist for this project. */
  angles: z.array(AngleSchema).min(1),
  /** Path/domain -> expert skill routing for implementer and reviewer. */
  domains: z.array(DomainSchema).default([]),
  /** Project-specific classifier signals per size bucket. */
  sizeRules: z.array(SizeRuleSchema).default([]),

  /** Vestigial, see `BoardSchema`'s doc comment. A fresh `litecode init` no longer writes it. */
  board: BoardSchema.default({
    enabled: true,
    owner: "",
    dataFile: ".claude/data/board.json",
    itemIdCache: ".claude/data/github-project-item-ids.json",
  }),
  /** Optional: absent entirely in a config predating the local ticket buffer feature. */
  tickets: TicketsSchema.default({
    enabled: true,
    dir: "docs/tickets",
  }),

  /**
   * Free-text working language for agent prose (e.g. "French", "Brazilian Portuguese") —
   * not a BCP-47 code, not validated against a list, and never auto-detected. Deliberately
   * `.optional()` with NO `.default()`, same reasoning as `tickets` above but for the
   * opposite risk: every pack site that interpolates it is wrapped in
   * `{{#if project.language}}…{{/if}}`, so an absent key renders byte-identical to today.
   * A `.default("English")` would silently inject a new instruction into the rendered
   * prompts of every existing project on upgrade — a behavior change disguised as a
   * default, not caught by any config diff. See ADR 0011.
   */
  language: z.string().optional(),

  /** Required only when the `web` pack is installed — it is what its expert skills interpolate. */
  web: z
    .object({
      /** Path to the web app in the repo, e.g. "apps/web" or "." for a single-app repo. */
      appDir: z.string(),
      /** e.g. "TanStack Start / React 19", "Next.js 15 App Router". */
      framework: z.string(),
      /** One line: how the API client is produced and how call sites are expected to use it. */
      apiClient: z.string(),
      /** Where shared types/schemas are generated from, so hand-written duplicates can be flagged. */
      typeSourceOfTruth: z.string(),
      /** The command that is ground truth for type errors in this app. */
      typecheck: z.string(),
      /** Styling system in use, e.g. "Tailwind + shadcn/ui". */
      styling: z.string(),
    })
    .optional(),
});

/**
 * Capability tier -> concrete model, per render target. Packs never name a model;
 * this is the single place a provider's model ids appear, which is what makes the
 * same pack renderable for Claude Code today and an OpenAI/DeepSeek runner later.
 */
export const TierMapSchema = z.object({
  fast: z.string(),
  balanced: z.string(),
  reasoning: z.string(),
});

export const ModelPricingSchema = z.object({
  /** USD charged per million input tokens. */
  inputPerMillion: z.number().nonnegative(),
  /** USD charged per million output tokens, including reasoning tokens reported as output. */
  outputPerMillion: z.number().nonnegative(),
});

/** Direct-API runner settings. Optional so Claude Code-only projects stay unchanged. */
export const RunnerSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "deepseek"]),
    /** Provider model id for each capability tier declared by pack agents. */
    models: TierMapSchema,
    /** Current provider prices keyed by concrete model id; LiteCodeAgent never hard-codes prices. */
    pricing: z.record(z.string(), ModelPricingSchema).optional(),
    /** Stop a run when reported usage crosses this amount. Requires pricing for every configured model. */
    maxCostUsd: z.number().positive().optional(),
    /** Environment variable containing the API key. Defaults per provider at runtime. */
    apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    /** Override for compatible gateways, proxies, or self-hosted endpoints. */
    baseUrl: z.string().url().optional(),
    /** Project-owned skills for the runner. Keep these outside the configured native agent output directory. */
    skillDirs: z.array(z.string()).default([]),
    maxTurns: z.number().int().positive().max(100).default(30),
    maxDepth: z.number().int().nonnegative().max(10).default(4),
    maxAgentCalls: z.number().int().positive().max(256).default(32),
    maxOutputTokens: z.number().int().positive().default(16_384),
    toolOutputLimit: z.number().int().positive().default(50_000),
    bashTimeoutMs: z.number().int().positive().default(120_000),
    /** Wall-clock limit for the complete agent tree. */
    runTimeoutMs: z.number().int().positive().max(86_400_000).default(1_800_000),
    /** Limit for one provider HTTP attempt. */
    requestTimeoutMs: z.number().int().positive().max(3_600_000).default(300_000),
    /** Retries after a retryable HTTP response; the first request is not counted. */
    maxRetries: z.number().int().nonnegative().max(10).default(2),
    retryBaseDelayMs: z.number().int().positive().max(60_000).default(500),
    retryMaxDelayMs: z.number().int().positive().max(300_000).default(10_000),
  })
  .superRefine((runner, ctx) => {
    if (runner.retryMaxDelayMs < runner.retryBaseDelayMs) {
      ctx.addIssue({
        code: "custom",
        path: ["retryMaxDelayMs"],
        message: "retryMaxDelayMs must be greater than or equal to retryBaseDelayMs",
      });
    }
    if (runner.maxCostUsd === undefined) return;
    for (const model of new Set(Object.values(runner.models))) {
      if (!runner.pricing?.[model]) {
        ctx.addIssue({
          code: "custom",
          path: ["pricing", model],
          message: `pricing is required for model '${model}' when maxCostUsd is set`,
        });
      }
    }
  });

export const ConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Legacy single-target setting. `targets` takes precedence when present. */
  target: z.enum(["claude-code", "codex", "pi", "opencode", "kilo-code"]).default("claude-code"),
  /** Harnesses to install together. Omit to preserve the legacy `target` behavior. */
  targets: z.array(z.enum(["claude-code", "codex", "pi", "opencode", "kilo-code"]))
    .min(1)
    .optional(),
  tiers: TierMapSchema.default({ fast: "haiku", balanced: "sonnet", reasoning: "opus" }),
  /** Pack names to install, in order. Later packs may not overwrite earlier ones. */
  packs: z.array(z.string()).min(1),
  /** Where rendered agents/skills land in the target repo. */
  outDir: z.string().default(".claude"),
  /** Optional provider-neutral runner. `litecode run` requires this block. */
  runner: RunnerSchema.optional(),
  project: ProjectSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export const TARGETS = ["claude-code", "codex", "pi", "opencode", "kilo-code"] as const;
export type InstallTarget = (typeof TARGETS)[number];

/** What each tool is called by the people who use it, and where its files land. */
export const TARGET_INFO: Record<InstallTarget, { label: string; description: string; directory: string }> = {
  "claude-code": {
    label: "Claude Code",
    description: "Anthropic's coding agent, in the terminal or your IDE",
    directory: ".claude/",
  },
  codex: {
    label: "Codex",
    description: "OpenAI's coding agent",
    directory: ".codex/ and .agents/skills/",
  },
  pi: {
    label: "Pi",
    description: "The Pi coding agent",
    directory: ".pi/",
  },
  opencode: {
    label: "OpenCode",
    description: "The open-source terminal coding agent",
    directory: ".opencode/",
  },
  "kilo-code": {
    label: "Kilo Code",
    description: "The Kilo Code VS Code extension",
    directory: ".kilo/",
  },
};

export function selectedTargets(config: Config): InstallTarget[] {
  return [...new Set(config.targets ?? [config.target])];
}

export const CONFIG_FILENAME = "litecode.config.json";

export async function loadConfig(projectRoot: string): Promise<{ config: Config; path: string }> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `No ${CONFIG_FILENAME} at ${path}. Run \`bunx litecodeagent init\` in the target repo first.`,
    );
  }
  const raw = await file.text();
  // `init` seeds placeholders on purpose; installing with them still in place would bake
  // "TODO" into agent prompts, where it reads as an instruction rather than an omission.
  if (/\bTODO\b/.test(raw)) {
    const lines = raw
      .split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /\bTODO\b/.test(line))
      .map(([n, line]) => `  ${String(n).padStart(4)}: ${line.trim()}`)
      .join("\n");
    throw new Error(`${CONFIG_FILENAME} still has unfilled placeholders:\n${lines}`);
  }
  const parsed = ConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`${CONFIG_FILENAME} is invalid:\n${issues}`);
  }
  return { config: parsed.data, path };
}
