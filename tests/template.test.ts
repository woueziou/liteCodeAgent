import { expect, test } from "bun:test";
import { render, referencedPaths, TemplateError } from "../src/template.ts";

test("interpolates nested paths", () => {
  expect(render("repo: {{ project.repo }}", { project: { repo: "a/b" } })).toBe("repo: a/b");
});

test("an undefined path is an error, never an empty string", () => {
  expect(() => render("{{ project.nope }}", { project: {} })).toThrow(TemplateError);
});

test("{{ . }} works for primitive each items", () => {
  const out = render("{{#each project.xs}}- {{ . }}\n{{/each}}", { project: { xs: ["a", "b"] } });
  expect(out).toBe("- a\n- b\n");
});

test("each over objects resolves item fields first, then root", () => {
  const out = render("{{#each project.xs}}{{ name }}@{{ project.repo }} {{/each}}", {
    project: { repo: "a/b", xs: [{ name: "x" }, { name: "y" }] },
  });
  expect(out).toBe("x@a/b y@a/b ");
});

test("standalone block tags leave no blank line", () => {
  const out = render("A\n{{#if project.on}}\nB\n{{/if}}\nC", { project: { on: true } });
  expect(out).toBe("A\nB\nC");
});

test("{{^if}} renders when falsy, and empty arrays are falsy", () => {
  expect(render("{{^if project.xs}}none{{/if}}", { project: { xs: [] } })).toBe("none");
  expect(render("{{#if project.xs}}some{{/if}}", { project: { xs: [] } })).toBe("");
});

test("codelist and join filters", () => {
  const ctx = { project: { xs: ["a", "b"] } };
  expect(render("{{ project.xs | join }}", ctx)).toBe("a, b");
  expect(render("{{ project.xs | codelist }}", ctx)).toBe("`a`, `b`");
});

test("nested if inside each", () => {
  const out = render("{{#each project.xs}}{{#if on}}[{{ name }}]{{/if}}{{/each}}", {
    project: { xs: [{ name: "a", on: true }, { name: "b", on: false }] },
  });
  expect(out).toBe("[a]");
});

test("referencedPaths strips filter suffixes", () => {
  expect(referencedPaths("skills: {{ project.agentSkills.sync | join }}")).toEqual([
    "project.agentSkills.sync",
  ]);
  expect(referencedPaths("{{ project.xs | codelist }}")).toEqual(["project.xs"]);
});

test("referencedPaths reports the {{#each}} root path but not item-scoped fields inside it", () => {
  const paths = referencedPaths(
    "{{#each project.xs}}{{ name }}@{{ project.repo }}{{#if on}}[{{ label }}]{{/if}}{{/each}}",
  );
  expect(paths).toEqual(["project.xs", "project.repo"]);
});

test("referencedPaths ignores {{ . }} and standalone-slash close tags", () => {
  expect(referencedPaths("{{#each project.xs}}{{ . }}{{/each}}")).toEqual(["project.xs"]);
});
