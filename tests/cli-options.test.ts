import { expect, test } from "bun:test";
import { unknownArguments } from "../src/cli-options.ts";

const KNOWN = ["--yes", "-y"];

test("known options and the value of a valued option are accepted", () => {
  expect(unknownArguments(["--yes", "-y"], KNOWN)).toEqual([]);
  expect(unknownArguments(["--project", "/some/dir", "--yes"], KNOWN, ["--project"])).toEqual([]);
});

test("a mistyped option and a stray word are both reported, in order", () => {
  expect(unknownArguments(["--yez", "everything", "--yes"], KNOWN)).toEqual(["--yez", "everything"]);
});

test("a value that looks like an option is still consumed by its valued option", () => {
  expect(unknownArguments(["--project", "--yes"], KNOWN, ["--project"])).toEqual([]);
});

test("`--opt=value` is not the same as `--opt value`", () => {
  expect(unknownArguments(["--yes=1"], KNOWN)).toEqual(["--yes=1"]);
});

test("a valued option at the end with no value does not throw", () => {
  expect(unknownArguments(["--project"], KNOWN, ["--project"])).toEqual([]);
});
