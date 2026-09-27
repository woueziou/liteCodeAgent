/**
 * Enforces, in code, the rule that so far lived only in agent prose (`implementer.md`):
 * no agent commits directly on the project's default branch. Ticket 0033.
 *
 * Kept as a pure function so both the CLI command (`litecode guard-branch`, called from
 * `.githooks/pre-commit`) and its tests can drive it without spawning git or a shell.
 */

export type GuardBranchInput = {
  /** The branch the commit is about to land on, e.g. from `git branch --show-current`. */
  branch: string;
  defaultBranch: string;
  /** `project.allowDefaultBranchCommits` from `litecode.config.json`. */
  allowDefaultBranchCommits: boolean;
  /**
   * Value of `LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT` at commit time, if any — an
   * env-var override a human sets for a single one-off commit without touching config.
   * Any non-empty value other than "0"/"false" counts as "set".
   */
  envOverride?: string;
};

export type GuardBranchResult = { allowed: true } | { allowed: false; reason: string };

function isOverrideSet(value: string | undefined): boolean {
  if (!value) return false;
  return value !== "0" && value.toLowerCase() !== "false";
}

export function checkBranchGuard(input: GuardBranchInput): GuardBranchResult {
  if (input.branch !== input.defaultBranch) return { allowed: true };
  if (input.allowDefaultBranchCommits) return { allowed: true };
  if (isOverrideSet(input.envOverride)) return { allowed: true };
  return {
    allowed: false,
    reason:
      `refusing to commit on '${input.defaultBranch}' (the project's default branch). ` +
      `Move the work onto a feature branch, or set project.allowDefaultBranchCommits: true ` +
      `in litecode.config.json, or set LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT=1 for this one commit.`,
  };
}
