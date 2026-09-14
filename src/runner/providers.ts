import type {
  AssistantMessage,
  Completion,
  CompletionRequest,
  Provider,
  RetryEvent,
  RunnerMessage,
  TokenUsage,
  ToolCall,
} from "./types.ts";

export type HttpTransport = (url: string, init: RequestInit) => Promise<Response>;

export type ProviderReliability = {
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
};

type RequestReliability = ProviderReliability & {
  signal?: AbortSignal;
  onRetry?: (event: RetryEvent) => void;
};

const DEFAULT_RELIABILITY: ProviderReliability = {
  requestTimeoutMs: 300_000,
  maxRetries: 2,
  retryBaseDelayMs: 500,
  retryMaxDelayMs: 10_000,
};

export class ProviderError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  readonly attempts: number;
  readonly code: "http_error" | "request_timeout" | "transport_error" | "invalid_response";

  constructor(
    message: string,
    options: {
      status?: number;
      requestId?: string;
      attempts?: number;
      code?: ProviderError["code"];
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.status = options.status;
    this.requestId = options.requestId;
    this.attempts = options.attempts ?? 1;
    this.code = options.code ?? "http_error";
  }
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeReliability(options?: Partial<ProviderReliability>): ProviderReliability {
  return { ...DEFAULT_RELIABILITY, ...options };
}

function requestId(response: Response): string | undefined {
  return response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
}

function retryDelay(response: Response, retry: number, options: ProviderReliability): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    const fromHeader = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(header) - Date.now();
    if (Number.isFinite(fromHeader)) return Math.min(options.retryMaxDelayMs, Math.max(0, fromHeader));
  }
  return Math.min(options.retryMaxDelayMs, options.retryBaseDelayMs * 2 ** (retry - 1));
}

function retryable(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function notifyRetry(callback: RequestReliability["onRetry"], event: RetryEvent): void {
  try {
    callback?.(event);
  } catch {
    // Observability callbacks must never replace the provider result or retry policy.
  }
}

function abortReason(signal: AbortSignal, fallback: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal, "Provider retry cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!, "Provider retry cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function attemptSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timeout = false;
  const onAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timeout = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function postJson(
  transport: HttpTransport,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: RequestReliability,
): Promise<{ data: Record<string, any>; requestId?: string; attempts: number }> {
  const encoded = JSON.stringify(body);
  for (let attempt = 1; ; attempt++) {
    if (options.signal?.aborted) throw abortReason(options.signal, "Provider request cancelled");
    const scoped = attemptSignal(options.signal, options.requestTimeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await transport(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: encoded,
        signal: scoped.signal,
      });
      text = await response.text();
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal, "Provider request cancelled");
      if (scoped.timedOut()) {
        throw new ProviderError(`Provider request timed out after ${options.requestTimeoutMs}ms`, {
          attempts: attempt,
          code: "request_timeout",
          cause: error,
        });
      }
      throw new ProviderError(`Provider transport failed: ${(error as Error).message}`, {
        attempts: attempt,
        code: "transport_error",
        cause: error,
      });
    } finally {
      scoped.cleanup();
    }

    const id = requestId(response);
    if (!response.ok) {
      if (retryable(response.status) && attempt <= options.maxRetries) {
        const delayMs = retryDelay(response, attempt, options);
        notifyRetry(options.onRetry, {
          retry: attempt,
          maxRetries: options.maxRetries,
          delayMs,
          status: response.status,
          requestId: id,
        });
        await abortableDelay(delayMs, options.signal);
        continue;
      }
      throw new ProviderError(`Provider request failed (${response.status}): ${text.slice(0, 2_000)}`, {
        status: response.status,
        requestId: id,
        attempts: attempt,
      });
    }
    try {
      return { data: JSON.parse(text) as Record<string, any>, requestId: id, attempts: attempt };
    } catch (error) {
      throw new ProviderError(`Provider returned invalid JSON: ${text.slice(0, 500)}`, {
        requestId: id,
        attempts: attempt,
        code: "invalid_response",
        cause: error,
      });
    }
  }
}

function parseArguments(id: string, name: string, raw: unknown): ToolCall {
  if (typeof raw !== "string") return { id, name, input: raw };
  try {
    return { id, name, input: JSON.parse(raw) };
  } catch (error) {
    return {
      id,
      name,
      input: {},
      parseError: `Tool arguments were not valid JSON: ${(error as Error).message}`,
    };
  }
}

function usage(input: unknown, output: unknown, total: unknown): TokenUsage | undefined {
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input, output, total: typeof total === "number" ? total : input + output };
}

export class OpenAIProvider implements Provider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly transport: HttpTransport = fetch,
    private readonly reliability: ProviderReliability = DEFAULT_RELIABILITY,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const input: unknown[] = [];
    for (const message of request.messages) {
      if (message.role === "user") {
        input.push({ role: "user", content: message.content });
      } else if (message.role === "assistant") {
        if (message.content) input.push({ role: "assistant", content: message.content });
        for (const call of message.toolCalls) {
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.input),
          });
        }
      } else {
        input.push({
          type: "function_call_output",
          call_id: message.toolCallId,
          output: message.isError ? `TOOL ERROR: ${message.content}` : message.content,
        });
      }
    }

    const response = await postJson(
      this.transport,
      `${trimSlash(this.baseUrl)}/responses`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: request.model,
        instructions: request.system,
        input,
        tools: request.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          strict: false,
        })),
        tool_choice: "auto",
        parallel_tool_calls: true,
        max_output_tokens: request.maxOutputTokens,
        store: false,
      },
      { ...this.reliability, signal: request.signal, onRetry: request.onRetry },
    );
    const data = response.data;

    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const item of data.output ?? []) {
      if (item.type === "message") {
        for (const part of item.content ?? []) {
          if (part.type === "output_text" && typeof part.text === "string") text.push(part.text);
        }
      } else if (item.type === "function_call") {
        toolCalls.push(parseArguments(item.call_id ?? item.id, item.name, item.arguments));
      }
    }
    return {
      message: { role: "assistant", content: text.join("\n"), toolCalls },
      usage: usage(data.usage?.input_tokens, data.usage?.output_tokens, data.usage?.total_tokens),
      requestId: response.requestId,
      attempts: response.attempts,
    };
  }
}

function anthropicMessages(messages: RunnerMessage[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content });
    } else {
      const content: unknown[] = [];
      let cursor = i;
      while (cursor < messages.length && messages[cursor]?.role === "tool") {
        const result = messages[cursor] as Extract<RunnerMessage, { role: "tool" }>;
        content.push({
          type: "tool_result",
          tool_use_id: result.toolCallId,
          content: result.content,
          is_error: result.isError,
        });
        cursor++;
      }
      out.push({ role: "user", content });
      i = cursor - 1;
    }
  }
  return out;
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.anthropic.com/v1",
    private readonly transport: HttpTransport = fetch,
    private readonly reliability: ProviderReliability = DEFAULT_RELIABILITY,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const response = await postJson(
      this.transport,
      `${trimSlash(this.baseUrl)}/messages`,
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: request.model,
        system: request.system,
        messages: anthropicMessages(request.messages),
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        })),
        max_tokens: request.maxOutputTokens,
      },
      { ...this.reliability, signal: request.signal, onRetry: request.onRetry },
    );
    const data = response.data;
    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of data.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") text.push(block.text);
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }
    return {
      message: { role: "assistant", content: text.join("\n"), toolCalls },
      usage: usage(
        data.usage?.input_tokens,
        data.usage?.output_tokens,
        (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      ),
      requestId: response.requestId,
      attempts: response.attempts,
    };
  }
}

export class DeepSeekProvider implements Provider {
  readonly name = "deepseek";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.deepseek.com",
    private readonly transport: HttpTransport = fetch,
    private readonly reliability: ProviderReliability = DEFAULT_RELIABILITY,
  ) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    const messages: unknown[] = [{ role: "system", content: request.system }];
    for (const message of request.messages) {
      if (message.role === "user") messages.push({ role: "user", content: message.content });
      else if (message.role === "tool") {
        messages.push({
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.isError ? `TOOL ERROR: ${message.content}` : message.content,
        });
      } else {
        messages.push({
          role: "assistant",
          content: message.content || null,
          ...(typeof message.metadata?.reasoningContent === "string"
            ? { reasoning_content: message.metadata.reasoningContent }
            : {}),
          ...(message.toolCalls.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: JSON.stringify(call.input) },
                })),
              }
            : {}),
        });
      }
    }
    const response = await postJson(
      this.transport,
      `${trimSlash(this.baseUrl)}/chat/completions`,
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: request.model,
        messages,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        tool_choice: "auto",
        max_tokens: request.maxOutputTokens,
      },
      { ...this.reliability, signal: request.signal, onRetry: request.onRetry },
    );
    const data = response.data;
    const message = data.choices?.[0]?.message;
    if (!message) throw new ProviderError("DeepSeek returned no assistant message");
    const toolCalls = (message.tool_calls ?? []).map((call: Record<string, any>) =>
      parseArguments(call.id, call.function?.name, call.function?.arguments),
    );
    const assistant: AssistantMessage = {
      role: "assistant",
      content: typeof message.content === "string" ? message.content : "",
      toolCalls,
      ...(typeof message.reasoning_content === "string"
        ? { metadata: { reasoningContent: message.reasoning_content } }
        : {}),
    };
    return {
      message: assistant,
      usage: usage(data.usage?.prompt_tokens, data.usage?.completion_tokens, data.usage?.total_tokens),
      requestId: response.requestId,
      attempts: response.attempts,
    };
  }
}

export function createProvider(options: {
  provider: "openai" | "anthropic" | "deepseek";
  apiKey: string;
  baseUrl?: string;
  transport?: HttpTransport;
  reliability?: Partial<ProviderReliability>;
}): Provider {
  const reliability = normalizeReliability(options.reliability);
  if (options.provider === "openai") {
    return new OpenAIProvider(options.apiKey, options.baseUrl, options.transport, reliability);
  }
  if (options.provider === "anthropic") {
    return new AnthropicProvider(options.apiKey, options.baseUrl, options.transport, reliability);
  }
  return new DeepSeekProvider(options.apiKey, options.baseUrl, options.transport, reliability);
}
