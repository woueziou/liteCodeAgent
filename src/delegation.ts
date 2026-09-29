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

import type { InstallTarget } from "./config.ts";
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
        "caller's existing working directory, same as any other delegation. `implementer` creates its own " +
        "worktree with `git worktree add` as step 3 always did; nothing to state differently in the prompt."
      );
  }
}

/** Names of the agents a set of packs installs (`agents/<name>.md`). */
export function packAgentNames(packs: { pack: { files: { rel: string }[] } }[]): Set<string> {
  return new Set(packs.flatMap(({ pack }) => pack.files.flatMap((f) => /^agents\/([^/]+)\.md$/.exec(f.rel)?.[1] ?? [])));
}

/**
 * The `{{> …}}` helpers pack prompts may use, bound to one render target. With `agents`
 * (the pack agents being installed), delegating to anything else — a typo, an agent from
 * a pack that isn't installed — fails the render instead of failing at run time.
 */
export function delegationHelpers(target: RenderTarget, agents?: ReadonlySet<string>): Helpers {
  return {
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
    delegateImplementerIsolation(arg) {
      if (arg) throw new Error(`{{> delegateImplementerIsolation}} takes no argument, got '${arg}'`);
      return delegateImplementerIsolation(target);
    },
  };
}
