import { resolve, basename } from "node:path";
import { CONFIG_FILENAME } from "./config.ts";

/** Writes a starter config with the placeholders a human must fill in before installing. */
export async function init(projectRoot: string, packs: string[]): Promise<string> {
  const path = resolve(projectRoot, CONFIG_FILENAME);
  if (await Bun.file(path).exists()) throw new Error(`${CONFIG_FILENAME} already exists at ${path}`);

  const name = basename(projectRoot);
  const starter = {
    packs,
    outDir: ".claude",
    target: "claude-code",
    tiers: { fast: "haiku", balanced: "sonnet", reasoning: "opus" },
    project: {
      name,
      repo: `TODO-owner/${name}`,
      defaultBranch: "main",
      checkCommand: "TODO: the command that must pass before work is called done",
      typecheckCommands: [],
      worktreeRoot: "../worktrees",
      adrDir: "docs/decisions",
      conventions: ["TODO: one line per rule an implementer/reviewer must follow here"],
      trustBoundaries: ["TODO: one line per trust boundary a security review must assume"],
      lessons: [],
      angles: [
        {
          name: "correctness",
          covers: "Does the change actually solve the stated problem, and what edge cases does it miss.",
          triggeredBy: "always — every non-trivial change gets this angle",
          skills: ["critique-expert"],
          always: true,
        },
      ],
      domains: [],
      sizeRules: [],
      agentSkills: {
        "debate-angle": ["critique-expert"],
        planner: [],
        implementer: ["agent-attribution", "github-project-sync"],
        reviewer: ["agent-attribution", "github-project-sync", "critique-expert"],
        triage: ["github-project-sync"],
        dispatcher: ["github-project-sync"],
        tracker: ["github-project-sync", "agent-attribution"],
      },
      board: {
        enabled: true,
        owner: "TODO-owner",
        dataFile: ".claude/data/board.json",
        itemIdCache: ".claude/data/github-project-item-ids.json",
      },
    },
  };
  await Bun.write(path, `${JSON.stringify(starter, null, 2)}\n`);
  return path;
}
