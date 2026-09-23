/**
 * OpenRouter client for the AI chat (ported from Quantiom, trimmed): the
 * Chat Completions endpoint with tool calling, and the model catalog. The key
 * is the user's own, passed in by the caller; requests go straight from the
 * browser to openrouter.ai (the CSP allows that one origin). No server of ours
 * is involved.
 */

const BASE_URL = "https://openrouter.ai/api/v1";
// Attribution headers OpenRouter recommends (they show in the user's usage dashboard).
const APP_REFERER = "https://qc1.fly.dev";
const APP_TITLE = "QC-1";
/** A modest cap: without one OpenRouter pre-authorises the model's whole output budget. */
export const DEFAULT_MAX_TOKENS = 4096;

export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: unknown } };

export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = { id: string; name: string; arguments: string };

export type Fetch = typeof fetch;

/** One completion (no streaming); the assistant's text and the tool calls it asks for. Throws on HTTP errors. */
export async function chatCompletion(
  apiKey: string, model: string, messages: AgentMessage[], tools: ToolDef[], signal?: AbortSignal,
  maxTokens = DEFAULT_MAX_TOKENS, doFetch: Fetch = fetch,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await doFetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": APP_REFERER, "X-Title": APP_TITLE },
    body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, ...(tools.length ? { tools, tool_choice: "auto" } : {}) }),
    signal,
  });
  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch { /* none */ }
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300) || res.statusText}`);
  }
  const json = await res.json();
  const msg = json?.choices?.[0]?.message;
  const raw: unknown[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
  const toolCalls = raw.flatMap((c): ToolCall[] => {
    const call = c as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    return typeof call.id === "string" && typeof call.function?.name === "string"
      ? [{ id: call.id, name: call.function.name, arguments: typeof call.function.arguments === "string" ? call.function.arguments : "{}" }]
      : [];
  });
  return { content: typeof msg?.content === "string" ? msg.content : "", toolCalls };
}

export type Model = { id: string; name: string; tools: boolean };

/** The model catalog (no key needed), keeping the models that can call tools. */
export async function listModels(doFetch: Fetch = fetch): Promise<Model[]> {
  const res = await doFetch(`${BASE_URL}/models`, { headers: { "HTTP-Referer": APP_REFERER, "X-Title": APP_TITLE } });
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  const data: unknown = (await res.json())?.data;
  if (!Array.isArray(data)) throw new Error("unexpected /models response");
  return data.flatMap((m): Model[] => {
    const x = m as { id?: unknown; name?: unknown; supported_parameters?: unknown };
    if (typeof x.id !== "string") return [];
    const params = Array.isArray(x.supported_parameters) ? x.supported_parameters : [];
    return [{ id: x.id, name: typeof x.name === "string" ? x.name : x.id, tools: params.includes("tools") }];
  }).filter((m) => m.tools);
}
