import type { Tier } from "../packs.ts";

export type JsonSchema = Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type ToolCall = {
  id: string;
  name: string;
  input: unknown;
  /** Invalid provider-produced JSON is returned to the model as a tool error. */
  parseError?: string;
};

export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
  /** Adapter-owned continuation data, such as DeepSeek reasoning_content. */
  metadata?: Record<string, unknown>;
};
export type ToolMessage = {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
};
export type RunnerMessage = UserMessage | AssistantMessage | ToolMessage;

export type CompletionRequest = {
  system: string;
  model: string;
  messages: RunnerMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
};

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type Completion = {
  message: AssistantMessage;
  usage?: TokenUsage;
};

export interface Provider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<Completion>;
}

export type AgentDefinition = {
  name: string;
  description: string;
  tier: Tier;
  tools: string[];
  skills: string[];
  prompt: string;
};

export type ToolResult = { content: string; isError?: boolean };

export type TraceEvent =
  | { type: "agent-start"; agent: string; depth: number; model: string }
  | { type: "agent-end"; agent: string; depth: number; turns: number }
  | { type: "tool-start"; agent: string; tool: string; callId: string }
  | { type: "tool-end"; agent: string; tool: string; callId: string; isError: boolean }
  | { type: "usage"; agent: string; usage: TokenUsage };
