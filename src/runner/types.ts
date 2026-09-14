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
  signal?: AbortSignal;
  onRetry?: (event: RetryEvent) => void;
};

export type RetryEvent = {
  retry: number;
  maxRetries: number;
  delayMs: number;
  status: number;
  requestId?: string;
};

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type UsageBreakdown = TokenUsage & {
  agent: string;
  model: string;
  requests: number;
  /** Null when no price was configured or a provider omitted usage. */
  costUsd: number | null;
};

export type RunUsage = TokenUsage & {
  requests: number;
  /** Null when the total cannot be calculated from configured prices and provider usage. */
  costUsd: number | null;
  byAgent: UsageBreakdown[];
};

export type RunErrorInfo = {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
  requestId?: string;
  attempts?: number;
};

export type RunReportBase = {
  provider: string;
  agent: string;
  agentCalls: number;
  startedAt: string;
  durationMs: number;
  retries: number;
  requestIds: string[];
  usage: RunUsage;
};

export type RunReport = RunReportBase & {
  status: "completed";
  output: string;
  error: null;
};

export type RunFailureReport = RunReportBase & {
  status: "failed" | "cancelled" | "timed_out";
  output: null;
  error: RunErrorInfo;
};

export type RunOutcome = RunReport | RunFailureReport;

export type Completion = {
  message: AssistantMessage;
  usage?: TokenUsage;
  requestId?: string;
  attempts?: number;
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
  | ({ type: "retry"; agent: string; model: string } & RetryEvent)
  | {
      type: "usage";
      agent: string;
      model: string;
      usage: TokenUsage | null;
      costUsd: number | null;
      totalCostUsd: number | null;
    };
