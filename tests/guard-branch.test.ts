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
