import { expect, test } from "bun:test";
import { AnthropicProvider, DeepSeekProvider, OpenAIProvider, type HttpTransport } from "../src/runner/providers.ts";
import type { CompletionRequest } from "../src/runner/types.ts";

const baseRequest = (): CompletionRequest => ({
  system: "system prompt",
  model: "model-id",
  messages: [{ role: "user", content: "hello" }],
  tools: [
    {
      name: "Read",
      description: "read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ],
  maxOutputTokens: 1234,
});

test("OpenAI adapter maps Responses API function calls into the runner contract", async () => {
  let requestBody: Record<string, any> = {};
  const transport: HttpTransport = async (url, init) => {
    expect(url).toBe("https://openai.test/v1/responses");
    requestBody = JSON.parse(String(init.body));
    return Response.json({
      output: [
        { type: "message", content: [{ type: "output_text", text: "checking" }] },
        { type: "function_call", call_id: "call-1", name: "Read", arguments: '{"path":"README.md"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
  };
  const result = await new OpenAIProvider("secret", "https://openai.test/v1", transport).complete(baseRequest());

  expect(requestBody).toMatchObject({ model: "model-id", store: false, parallel_tool_calls: true });
  expect(requestBody.tools[0]).toMatchObject({ type: "function", name: "Read" });
  expect(result.message.toolCalls).toEqual([{ id: "call-1", name: "Read", input: { path: "README.md" } }]);
  expect(result.usage).toEqual({ input: 10, output: 5, total: 15 });
});

test("OpenAI and DeepSeek adapters label tool failures in formats without an error field", async () => {
  const bodies: Record<string, any>[] = [];
  const transport: HttpTransport = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json(
      bodies.length === 1
        ? { output: [{ type: "message", content: [{ type: "output_text", text: "done" }] }] }
        : { choices: [{ message: { role: "assistant", content: "done" } }] },
    );
  };
  const request = baseRequest();
  request.messages.push({ role: "tool", toolCallId: "bad", name: "Read", content: "missing", isError: true });

  await new OpenAIProvider("secret", "https://openai.test/v1", transport).complete(request);
  await new DeepSeekProvider("secret", "https://deepseek.test", transport).complete(request);
  expect(bodies[0]!.input.at(-1).output).toBe("TOOL ERROR: missing");
  expect(bodies[1]!.messages.at(-1).content).toBe("TOOL ERROR: missing");
});

test("Anthropic adapter groups sibling tool results into the required user message", async () => {
  let requestBody: Record<string, any> = {};
  const transport: HttpTransport = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return Response.json({ content: [{ type: "text", text: "done" }], usage: { input_tokens: 8, output_tokens: 2 } });
  };
  const request = baseRequest();
  request.messages.push(
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "a", name: "Read", input: { path: "a" } },
        { id: "b", name: "Read", input: { path: "b" } },
      ],
    },
    { role: "tool", toolCallId: "a", name: "Read", content: "A", isError: false },
    { role: "tool", toolCallId: "b", name: "Read", content: "B", isError: true },
  );
  const result = await new AnthropicProvider("secret", "https://anthropic.test/v1", transport).complete(request);

  const toolMessage = requestBody.messages.at(-1);
  expect(toolMessage.role).toBe("user");
  expect(toolMessage.content).toHaveLength(2);
  expect(toolMessage.content[1]).toMatchObject({ tool_use_id: "b", is_error: true });
  expect(result.message.content).toBe("done");
});

test("DeepSeek adapter preserves reasoning content across tool turns", async () => {
  const bodies: Record<string, any>[] = [];
  const transport: HttpTransport = async (_url, init) => {
    bodies.push(JSON.parse(String(init.body)));
    if (bodies.length === 1) {
      return Response.json({
        choices: [{ message: {
          role: "assistant",
          content: null,
          reasoning_content: "private continuation",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "Read", arguments: '{"path":"x"}' } }],
        } }],
      });
    }
    return Response.json({ choices: [{ message: { role: "assistant", content: "done" } }] });
  };
  const provider = new DeepSeekProvider("secret", "https://deepseek.test", transport);
  const first = await provider.complete(baseRequest());
  const secondRequest = baseRequest();
  secondRequest.messages.push(
    first.message,
    { role: "tool", toolCallId: "call-1", name: "Read", content: "contents", isError: false },
  );
  await provider.complete(secondRequest);

  const continued = bodies[1]!.messages.find((message: Record<string, any>) => message.role === "assistant");
  expect(continued.reasoning_content).toBe("private continuation");
  expect(continued.tool_calls[0].function.arguments).toBe('{"path":"x"}');
});
