import { expect, test } from "bun:test";
import { join } from "node:path";

const skill = Bun.file(join(import.meta.dir, "..", "skills/setup/SKILL.md")).text();

// The plugin's setup skill walks a user through the same flow as the CLI. It once described a
// flow that no longer exists (TODO placeholders, `install`, `ticket doctor`); these tests pin it
// to the commands the CLI actually has (tickets 0083, 0084, 0085, 0091).

test("the setup skill uses the current flow: setup, setup --apply, doctor", async () => {
  const text = await skill;
  expect(text).toContain("litecode setup");
  expect(text).toContain("litecode setup --apply");
  expect(text).toContain("litecode doctor");
});

test("the setup skill names none of the removed commands or behaviours", async () => {
  const text = await skill;
  expect(text).not.toContain("litecode install");
  expect(text).not.toContain("ticket doctor");
  expect(text).not.toContain("config doctor");
  expect(text).not.toMatch(/\bTODO\b/);
  expect(text).not.toContain("--fix");
});

test("the setup skill never tells the user to run `litecode config edit` as a step", async () => {
  const text = await skill;
  // It may mention the editor once, to say it needs a terminal; it must not instruct to run it.
  const mentions = text.match(/litecode config edit/g) ?? [];
  expect(mentions.length).toBeLessThanOrEqual(1);
  expect(text).toMatch(/config edit` needs a terminal/);
});

test("the setup skill asks the user for the values that cannot be detected and for the routing rules", async () => {
  const text = await skill;
  expect(text).toContain("project.checkCommand");
  expect(text).toContain("project.repo");
  expect(text).toMatch(/routing rule/i);
  // A plugin skill has no terminal: it must use `config set`, not the interactive editor.
  expect(text).toContain("project.domains");
  expect(text).not.toMatch(/litecode config edit`\s+(to|and|,)/);
});

test("the setup skill points to /litecode and to upgrade for later", async () => {
  const text = await skill;
  expect(text).toContain("/litecode");
  expect(text).toContain("litecode upgrade");
});
