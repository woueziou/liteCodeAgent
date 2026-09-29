import { expect, test } from "bun:test";
import { checkBranchGuard } from "../src/guard-branch.ts";

test("allows a commit on a feature branch", () => {
  const result = checkBranchGuard({ branch: "feat/x/0001", defaultBranch: "main", allowDefaultBranchCommits: false });
  expect(result.allowed).toBe(true);
});

test("refuses a commit on the default branch by default", () => {
  const result = checkBranchGuard({ branch: "main", defaultBranch: "main", allowDefaultBranchCommits: false });
  expect(result.allowed).toBe(false);
  if (!result.allowed) expect(result.reason).toContain("main");
});

test("the refusal message suggests all three ways out: a feature branch, the config flag, and the env override", () => {
  const result = checkBranchGuard({ branch: "main", defaultBranch: "main", allowDefaultBranchCommits: false });
  expect(result.allowed).toBe(false);
  if (!result.allowed) {
    expect(result.reason).toContain("git switch -c");
    expect(result.reason).toContain("project.allowDefaultBranchCommits");
    expect(result.reason).toContain("LITECODE_ALLOW_DEFAULT_BRANCH_COMMIT");
  }
});

test("allows a commit on the default branch when project.allowDefaultBranchCommits is true", () => {
  const result = checkBranchGuard({ branch: "main", defaultBranch: "main", allowDefaultBranchCommits: true });
  expect(result.allowed).toBe(true);
});

test("allows a commit on the default branch when the human sets the env override", () => {
  const result = checkBranchGuard({
    branch: "main",
    defaultBranch: "main",
    allowDefaultBranchCommits: false,
    envOverride: "1",
  });
  expect(result.allowed).toBe(true);
});

test("treats '0' and 'false' env override values as not set", () => {
  for (const value of ["0", "false", "False", ""]) {
    const result = checkBranchGuard({
      branch: "main",
      defaultBranch: "main",
      allowDefaultBranchCommits: false,
      envOverride: value,
    });
    expect(result.allowed).toBe(false);
  }
});

test("a default branch named something other than 'main' is guarded the same way", () => {
  const result = checkBranchGuard({ branch: "trunk", defaultBranch: "trunk", allowDefaultBranchCommits: false });
  expect(result.allowed).toBe(false);
});

test("allows a commit on the default branch made only of ticket files", () => {
  const base = { branch: "main", defaultBranch: "main", allowDefaultBranchCommits: false, ticketsDir: "docs/tickets" };
  expect(checkBranchGuard({ ...base, stagedPaths: ["docs/tickets/07-x/0042-a.md", "docs/tickets/0043-b.md"] }).allowed).toBe(true);
  expect(checkBranchGuard({ ...base, ticketsDir: "./docs/tickets/", stagedPaths: ["docs/tickets/0043-b.md"] }).allowed).toBe(true);
});

test("still refuses the default branch when a commit mixes ticket files with anything else", () => {
  const base = { branch: "main", defaultBranch: "main", allowDefaultBranchCommits: false, ticketsDir: "docs/tickets" };
  expect(checkBranchGuard({ ...base, stagedPaths: ["docs/tickets/0043-b.md", "src/cli.ts"] }).allowed).toBe(false);
  expect(checkBranchGuard({ ...base, stagedPaths: [] }).allowed).toBe(false);
  expect(checkBranchGuard({ ...base, stagedPaths: ["docs/tickets-old/x.md"] }).allowed).toBe(false);
  expect(checkBranchGuard({ ...base, stagedPaths: ["docs/tickets/../../src/cli.ts"] }).allowed).toBe(false);
});
