import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "litecode_run",
    label: "LiteCodeAgent planning workflow",
    description: "Run LiteCodeAgent's discussion, debate, synthesis, and planning workflow. This does not create issues or edit project files.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The raw idea, feature request, bug report, or doc need to discuss and plan." }),
    }),
    async execute(_toolCallId, params, signal) {
      const result = await pi.exec(
        "bunx",
        ["--yes", "litecodeagent", "run", "orchestrator", "--prompt", params.prompt],
        { signal, timeout: 1_800_000 },
      );
      const output = result.stdout.trim() || result.stderr.trim() || "LiteCodeAgent returned no output.";
      if (result.code !== 0) throw new Error(output);
      return { content: [{ type: "text", text: output }] };
    },
  });
}
