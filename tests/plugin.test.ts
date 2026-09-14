import { expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

test("Claude Code plugin metadata stays installable and versioned with the CLI", async () => {
  const pkg = await Bun.file(join(ROOT, "package.json")).json();
  const plugin = await Bun.file(join(ROOT, ".claude-plugin/plugin.json")).json();
  const marketplace = await Bun.file(join(ROOT, ".claude-plugin/marketplace.json")).json();

  expect(pkg.name).toBe("litecodeagent");
  expect(plugin.name).toBe("litecode-agent");
  expect(plugin.version).toBe(pkg.version);
  expect(marketplace.plugins).toContainEqual(
    expect.objectContaining({ name: plugin.name, source: "./" }),
  );

  // Packs contain project templates. Loading them as plugin components would expose unresolved
  // {{ project.* }} placeholders and bypass install's hard-error and lockfile guarantees.
  expect(plugin.agents).toBeUndefined();
  expect(plugin.skills).toBeUndefined();

  for (const executable of ["litecode", "litecodeagent"]) {
    const mode = (await stat(join(ROOT, "bin", executable))).mode;
    expect(mode & 0o111).not.toBe(0);
  }
});
