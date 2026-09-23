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
    default:
      return (
        "Every delegation is blocking: wait for the other agent's result in the same turn before going on. " +
        `If you can't delegate natively here (no subagent mechanism in this session, or you are yourself running as a subagent that isn't allowed to start another), ${RUNNER_FALLBACK}. ${never}`
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
  };
}
