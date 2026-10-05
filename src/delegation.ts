/**
 * How an agent hands work to another agent, worded for each place a pack prompt can run
 * (ADR 0014). Pack prompts never name a harness's tool directly: they write
 * `{{> delegate reviewer}}` and `{{> delegation}}`, and this module supplies the exact
 * mechanism per target. That replaces the old per-renderer `\bAgent\b` rewrite, which
 * also rewrote every unrelated use of the word (the `Agent:` commit trailer included) and
 * never reached skill files at all.
 *
 * The one thing every target must offer is a blocking delegation: start another agent and
 * get its result back in the same turn. Where the native mechanism can't do that (Pi has
 * none; a sub-agent may not be allowed to start another), the fallback is the project's
 * own API runner, `litecode run`, which is synchronous everywhere.
 */

import { TARGET_ROOTS, type InstallTarget } from "./config.ts";
import type { Helpers } from "./template.ts";

/** Every place a pack prompt is rendered: an install target, or the built-in API runner. */
export type RenderTarget = InstallTarget | "runner";

const AGENT_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * `general-purpose` isn't a pack agent: it's each harness's own built-in worker, which has
 * a different name (or none) everywhere.
 */
function delegateGeneral(target: RenderTarget): string {
  switch (target) {
    case "claude-code":
    case "runner":
      return "the `Agent` tool (subagent_type `general-purpose`)";
    case "opencode":
      return "the `task` tool (subagent_type `general`)";
    case "kilo-code":
      return "the `task` tool, targeting the built-in `general` subagent";
    case "codex":
      return "a Codex subagent — spawn a default worker and wait for its result";
    case "pi":
      return "`litecode run general-purpose --prompt-file <file>` via `Bash`";
  }
}

function delegate(target: RenderTarget, agent: string): string {
  if (agent === "general-purpose") return delegateGeneral(target);
  switch (target) {
    case "claude-code":
    case "runner":
      return `the \`Agent\` tool (subagent_type \`${agent}\`)`;
    case "opencode":
      return `the \`task\` tool (subagent_type \`${agent}\`)`;
    case "kilo-code":
      return `the \`task\` tool, targeting the \`${agent}\` subagent`;
    case "codex":
      return `a Codex subagent — spawn the \`${agent}\` custom agent by name and wait for its result`;
    case "pi":
      return `\`litecode run ${agent} --prompt-file <file>\` via \`Bash\``;
  }
}

/** `litecode` is on PATH only after install.sh; `bunx litecodeagent` works everywhere else. */
const NOT_ON_PATH = " (or `bunx litecodeagent run …` if `litecode` isn't on your PATH)";

const RUNNER_FALLBACK =
  `write the request to a temporary file and run \`litecode run <agent> --prompt-file <file>\`${NOT_ON_PATH} via \`Bash\`: ` +
  "it runs that agent through this project's configured API runner (`runner` in `litecode.config.json`), " +
  "waits for it, and prints its report. If you have no `Bash`, or the runner isn't configured, stop and say " +
  "so in your report";

function delegation(target: RenderTarget): string {
  const never = "Never do the other agent's work yourself in its place, and never write its report for it.";
  switch (target) {
    case "runner":
      return `Every delegation is a blocking \`Agent\` call: its result comes back in the same turn. ${never}`;
    case "pi":
      return (
        "Pi has no subagents, so every delegation here goes through `litecode run <agent> --prompt-file <file>`" +
        `${NOT_ON_PATH} via \`Bash\`, which runs the agent through this project's configured API runner and waits for it. ` +
        `If the runner isn't configured, stop and say so in your report. ${never}`
      );
    case "claude-code":
      return (
        "Every delegation is still blocking in effect, but the `Agent` tool doesn't always settle it within the same turn: " +
        "it may return the sub-agent's result immediately, or it may start the sub-agent in the background and return " +
        "right away, with the sub-agent's actual result arriving later, in a later turn, as its own completion " +
        "notification. You cannot tell in advance which of the two will happen, and a notification arriving later is " +
        "not a delegation gone wrong — it's the tool's normal background mode. A notification can only reach you after " +
        "the current turn has ended, so when that happens, simply let the turn end without writing anything — that is " +
        "the correct way to wait, not a lapse. What you must never do, in the gap between starting a delegation and " +
        "reading its result, whether that gap crosses a turn boundary or not, is hand back or send any report at all — " +
        "not a final `STATUS:`, and not an interim message (e.g. \"waiting on reviewer\"). Only once every delegation " +
        "you started has actually reported back to you — in the same turn or via a later notification you then read — " +
        `do you act on the results and send exactly one final report. If you can't delegate natively here (you are ` +
        `yourself running as a subagent that isn't allowed to start another), ${RUNNER_FALLBACK}. ${never}`
      );
    default:
      return (
        "Every delegation is blocking: wait for the other agent's result in the same turn before going on. " +
        `If you can't delegate natively here (no subagent mechanism in this session, or you are yourself running as a subagent that isn't allowed to start another), ${RUNNER_FALLBACK}. ${never}`
      );
  }
}

/**
 * Whether/how the target's own delegation mechanism can hand a sub-agent a dedicated git
 * worktree, so `implementer` never starts inside the caller's shared checkout in the first
 * place (ticket 0057 / ADR 0020). Only Claude Code's `Agent` tool has this: an `isolation:
 * "worktree"` option that creates the worktree before the sub-agent's first turn. No other
 * target documented here exposes an equivalent — `opencode`'s `task` tool, Kilo Code's
 * `task` tool, a Codex subagent, and Pi's `litecode run` all start in the caller's existing
 * working directory, with no per-call isolation knob. Inventing one for a target that
 * doesn't document it would be worse than not offering isolation at all, so those targets
 * keep the pre-0057 behavior: `implementer` creates its own worktree with `git worktree
 * add` as step 3 always did.
 */
function delegateImplementerIsolation(target: RenderTarget): string {
  switch (target) {
    case "claude-code":
      return (
        "This target supports per-call worktree isolation: pass `isolation: \"worktree\"` on the `Agent` call. " +
        "When you do, state explicitly in the prompt (a) the absolute path of the primary checkout " +
        "(the directory you were invoked in, before isolation moved `implementer` into its own worktree) and " +
        "(b) that `implementer` should treat the worktree it wakes up in as its ticket worktree instead of " +
        "creating a second one with `git worktree add` — see implementer.md's \"Worktree isolation\" section for " +
        "what it does with both."
      );
    case "runner":
    case "opencode":
    case "kilo-code":
    case "codex":
    case "pi":
      return (
        "This target has no per-call worktree isolation for a delegated `implementer` — it starts in the " +
        "caller's existing working directory, same as any other delegation. `implementer` picks its Isolation mode " +
        "itself with `litecode isolation start <NNNN>` (ADR 0023; `auto` is `inline` here); to force one for this " +
        "call, say `isolation mode: worktree` or `isolation mode: inline` in the prompt."
      );
  }
}

/**
 * Choosing the model of one delegated call (ticket 0061 / ADR 0021): a small ticket asks
 * for `bug-hunter` at the `balanced` tier instead of its default `reasoning` one, without a
 * second copy of the agent. Only Claude Code's `Agent` tool takes a per-call `model`; every
 * other target, and the API runner (which fixes a model per agent tier), keeps the agent's
 * own default tier, and the prompt says so instead of inventing a knob.
 */
const TIER_NAMES = ["fast", "balanced", "reasoning"];
const DEFAULT_TIER_MODELS: Record<string, string> = { fast: "haiku", balanced: "sonnet", reasoning: "opus" };

function delegateTier(target: RenderTarget, tier: string, tiers: Record<string, string | undefined>): string {
  if (!TIER_NAMES.includes(tier)) throw new Error(`{{> delegateTier ${tier}}}: unknown tier (known: ${TIER_NAMES.join(", ")})`);
  if (target === "claude-code") {
    const model = (Object.hasOwn(tiers, tier) ? tiers[tier] : undefined) ?? DEFAULT_TIER_MODELS[tier];
    if (!model) throw new Error(`{{> delegateTier ${tier}}}: no model configured for tier '${tier}'`);
    return `pass \`model: "${model}"\` on that call (the \`${tier}\` tier)`;
  }
  return (
    "this target cannot choose a model per call, so keep that agent's default tier — " +
    "nothing to add to the prompt and nothing lost but the saving"
  );
}

/**
 * Where each target installs the pack's `reference/*.md` files (rare-case docs an agent
 * Reads on demand, ticket 0064), relative to the project root. `claude-code` follows the
 * configured `outDir`; the API runner (which serves Pi) reads them from the first installed target's root.
 */
export const REFERENCE_ROOTS: Record<RenderTarget, string> = { ...TARGET_ROOTS, runner: TARGET_ROOTS["claude-code"] };

function reference(target: RenderTarget, name: string, rootOverride?: string): string {
  if (!/^[a-z][a-z-]*$/.test(name)) throw new Error(`{{> reference}} needs a reference name, got '${name}'`);
  const root = (rootOverride ?? REFERENCE_ROOTS[target]).replace(/\/+$/, "");
  return `\`${root}/reference/${name}.md\` (relative to the primary checkout)`;
}

/**
 * The shared "explicit human instruction only" guard of the skills that chain agents
 * (ticket 0088): one wording, so `chained-implementation` and `idea-to-planned` cannot drift.
 */
function humanGate(mustContain: string): string {
  return (
    `Every invocation must originate from an explicit human instruction ${mustContain}, in the current turn. ` +
    "It never runs speculatively, does not scan for work to pick up on its own, does not run periodically or on a schedule, " +
    "and does not react to work merely existing in a queue."
  );
}

/** Names of the agents a set of packs installs (`agents/<name>.md`). */
export function packAgentNames(packs: { pack: { files: { rel: string }[] } }[]): Set<string> {
  return new Set(packs.flatMap(({ pack }) => pack.files.flatMap((f) => /^agents\/([^/]+)\.md$/.exec(f.rel)?.[1] ?? [])));
}

/**
 * The body of every pack reference file (`reference/<name>.md`, frontmatter dropped, outer blank
 * lines trimmed), keyed by name: what `{{> inline <name>}}` puts in place (ADR 0027).
 */
export function packInlineSources(packs: { pack: { files: { rel: string; source: string }[] } }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { pack } of packs) {
    for (const f of pack.files) {
      const name = /^reference\/([^/]+)\.md$/.exec(f.rel)?.[1];
      if (name) out.set(name, f.source.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/^\n+|\n+$/g, ""));
    }
  }
  return out;
}

/**
 * The `{{> …}}` helpers pack prompts may use, bound to one render target. With `agents`
 * (the pack agents being installed), delegating to anything else — a typo, an agent from
 * a pack that isn't installed — fails the render instead of failing at run time.
 */
export function delegationHelpers(
  target: RenderTarget,
  agents?: ReadonlySet<string>,
  tiers: Record<string, string | undefined> = {},
  referenceRoot?: string,
  inlineSources?: ReadonlyMap<string, string>,
): Helpers {
  return {
    inline(arg) {
      const text = inlineSources?.get(arg);
      if (text === undefined) throw new Error(`{{> inline ${arg}}} names no pack reference file`);
      if (/\{\{>\s*inline\b/.test(text)) throw new Error(`{{> inline ${arg}}}: an inlined file cannot inline another`);
      return text;
    },
    reference(arg) {
      return reference(target, arg, referenceRoot);
    },
    delegate(arg) {
      if (!AGENT_NAME.test(arg)) throw new Error(`{{> delegate}} needs an agent name, got '${arg}'`);
      if (agents && arg !== "general-purpose" && !agents.has(arg)) {
        throw new Error(`{{> delegate ${arg}}} names no installed agent (known: ${[...agents].sort().join(", ")})`);
      }
      return delegate(target, arg);
    },
    delegation(arg) {
      if (arg) throw new Error(`{{> delegation}} takes no argument, got '${arg}'`);
      return delegation(target);
    },
    delegateTier(arg) {
      if (!/^[a-z]+$/.test(arg)) throw new Error(`{{> delegateTier}} needs a tier name, got '${arg}'`);
      return delegateTier(target, arg, tiers);
    },
    humanGate(arg) {
      if (!arg) throw new Error("{{> humanGate}} needs a phrase saying what the human instruction must contain");
      return humanGate(arg);
    },
    delegateImplementerIsolation(arg) {
      if (arg) throw new Error(`{{> delegateImplementerIsolation}} takes no argument, got '${arg}'`);
      return delegateImplementerIsolation(target);
    },
  };
}
