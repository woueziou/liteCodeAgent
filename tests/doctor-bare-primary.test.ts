import { expect, test } from "bun:test";
import { primaryCheckoutRoot } from "../src/doctor.ts";

test("primaryCheckoutRoot ignores a bare repository listed as the main worktree (ticket 0058)", () => {
  const bare = { path: "/srv/repo.git", branch: null, prunable: false, bare: true };
  const wt = { path: "/work/repo-main", branch: "main", prunable: false, bare: false };
  expect(primaryCheckoutRoot("/work/repo-main", [bare, wt])).toBe("/work/repo-main");
  expect(primaryCheckoutRoot("/work/other", [bare, wt])).toBe("/work/other");
  const normal = { path: "/work/primary", branch: "main", prunable: false, bare: false };
  expect(primaryCheckoutRoot("/work/wt", [normal, wt])).toBe("/work/primary");
});
