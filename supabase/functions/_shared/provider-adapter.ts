// ---------------------------------------------------------------------------
// Provider Adapter — unified interface for Groq, OpenAI, and Anthropic
//
// callLLM(provider, model, messages, temperature, maxTokens, apiKey, toolSchema?)
//   → { content, toolCallArguments, promptTokens, completionTokens, totalTokens }
//
// Each function now accepts the API key explicitly (instead of reading
// Deno.env.get()) so workspace-specific BYOK works.
// ---------------------------------------------------------------------------

export interface ToolSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResult {
  content: string | null;
  toolCallArguments: Record<string, unknown> | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible REST)
// ---------------------------------------------------------------------------

async function callGroqLLM(
  messages: LLMMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  toolSchema?: ToolSchema,
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (toolSchema) {
    body.tools = [{
      type: "function",
      function: {
        name: "submit_result",
        description: "Submit the structured result of this agent's execution",
        parameters: toolSchema,
      },
    }];
    body.tool_choice = { type: "function", function: { name: "submit_result" } };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("Groq returned no choices");

  const message = choice.message;
  let content: string | null = message?.content ?? null;
  let toolCallArguments: Record<string, unknown> | null = null;

  if (message?.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    if (toolCall.function?.name === "submit_result") {
      content = null;
      try {
        toolCallArguments = JSON.parse(toolCall.function.arguments);
      } catch {
        toolCallArguments = { raw: toolCall.function.arguments };
      }
    }
  }

  return {
    content,
    toolCallArguments,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// OpenAI (native REST)
// ---------------------------------------------------------------------------

async function callOpenAILLM(
  messages: LLMMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  toolSchema?: ToolSchema,
): Promise<LLMResult> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  if (toolSchema) {
    body.tools = [{
      type: "function",
      function: {
        name: "submit_result",
        description: "Submit the structured result of this agent's execution",
        parameters: toolSchema,
      },
    }];
    body.tool_choice = { type: "function", function: { name: "submit_result" } };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("OpenAI returned no choices");

  const message = choice.message;
  let content: string | null = message?.content ?? null;
  let toolCallArguments: Record<string, unknown> | null = null;

  if (message?.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];
    if (toolCall.function?.name === "submit_result") {
      content = null;
      try {
        toolCallArguments = JSON.parse(toolCall.function.arguments);
      } catch {
        toolCallArguments = { raw: toolCall.function.arguments };
      }
    }
  }

  return {
    content,
    toolCallArguments,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Anthropic (native REST — different format)
// ---------------------------------------------------------------------------

async function callAnthropicLLM(
  messages: LLMMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  apiKey: string,
  toolSchema?: ToolSchema,
): Promise<LLMResult> {
  // Anthropic sends system as a top-level parameter, not as a message role
  const systemMsgs: string[] = [];
  const apiMessages: { role: string; content: string }[] = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemMsgs.push(m.content);
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: apiMessages,
  };

  if (systemMsgs.length > 0) {
    body.system = systemMsgs.join("\n");
  }

  if (temperature !== undefined && temperature !== null) {
    body.temperature = temperature;
  }

  if (toolSchema) {
    body.tools = [{
      name: "submit_result",
      description: "Submit the structured result of this agent's execution",
      input_schema: toolSchema,
    }];
    body.tool_choice = { type: "tool", name: "submit_result" };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const data = await response.json();

  let content: string | null = null;
  let toolCallArguments: Record<string, unknown> | null = null;

  if (data.content && Array.isArray(data.content)) {
    const textBlock = data.content.find((b: { type: string }) => b.type === "text");
    if (textBlock) content = textBlock.text ?? null;

    const toolUseBlock = data.content.find(
      (b: { type: string }) => b.type === "tool_use",
    );
    if (toolUseBlock && toolUseBlock.name === "submit_result") {
      content = null;
      toolCallArguments = toolUseBlock.input ?? null;
    }
  }

  return {
    content,
    toolCallArguments,
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
    totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type LLMProvider = "groq" | "openai" | "anthropic";

/**
 * Call an LLM provider with the given parameters.
 *
 * @param provider   - "groq" | "openai" | "anthropic"
 * @param model      - Model name (e.g. "gpt-4", "claude-3-sonnet-20240229")
 * @param messages   - Array of messages
 * @param temperature - Temperature (0-2)
 * @param maxTokens  - Maximum output tokens
 * @param apiKey     - The API key to use for this provider
 * @param toolSchema - Optional tool schema for structured output
 */
export async function callLLM(
  provider: LLMProvider,
  model: string,
  messages: LLMMessage[],
  temperature: number,
  maxTokens: number,
  apiKey: string,
  toolSchema?: ToolSchema,
): Promise<LLMResult> {
  switch (provider) {
    case "groq":
      return await callGroqLLM(messages, model, temperature, maxTokens, apiKey, toolSchema);
    case "openai":
      return await callOpenAILLM(messages, model, temperature, maxTokens, apiKey, toolSchema);
    case "anthropic":
      return await callAnthropicLLM(messages, model, temperature, maxTokens, apiKey, toolSchema);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}