import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../src/frontmatter.ts";

async function* markdownFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* markdownFiles(abs);
    else if (entry.name.endsWith(".md")) yield abs;
  }
}

describe("parseFrontmatter", () => {
  test("parses every real pack file without throwing (golden coverage)", async () => {
    let count = 0;
    for await (const file of markdownFiles(join(import.meta.dir, "..", "packs"))) {
      const source = await Bun.file(file).text();
      if (!source.startsWith("---\n")) continue; // not every pack file carries frontmatter
      expect(() => parseFrontmatter(source, file)).not.toThrow();
      count++;
    }
    expect(count).toBeGreaterThan(0);
  });

  test("a body containing a markdown horizontal rule does not truncate parsing", () => {
    const source = [
      "---",
      "id: 0001-example",
      "title: Example",
      "---",
      "",
      "Intro text.",
      "",
      "---",
      "",
      "Text after a horizontal rule, which must stay in the body.",
      "",
    ].join("\n");

    const { data, body } = parseFrontmatter(source, "test");
    expect(data).toEqual({ id: "0001-example", title: "Example" });
    expect(body).toContain("Intro text.");
    expect(body).toContain("Text after a horizontal rule, which must stay in the body.");
  });

  test("a body that opens with a line merely starting with --- (not exactly ---) is not mistaken for the terminator", () => {
    const source = ["---", "id: x", "---", "", "---not-a-terminator", "rest"].join("\n");
    const { body } = parseFrontmatter(source, "test");
    expect(body).toContain("---not-a-terminator");
    expect(body).toContain("rest");
  });

  test("round-trips through serializeFrontmatter", () => {
    const data = { id: "0001-x", title: "Hello" };
    const body = "Some body\n\n---\n\nwith a rule in it\n";
    const serialized = serializeFrontmatter(data, body);
    const parsed = parseFrontmatter(serialized, "roundtrip");
    expect(parsed.data).toEqual(data);
    expect(parsed.body.trim()).toBe(body.trim());
  });

  test("still throws on missing frontmatter", () => {
    expect(() => parseFrontmatter("no frontmatter here", "test")).toThrow(/missing frontmatter/);
  });

  test("still throws on unterminated frontmatter", () => {
    expect(() => parseFrontmatter("---\nid: x\nno terminator", "test")).toThrow(/unterminated/);
  });
});
