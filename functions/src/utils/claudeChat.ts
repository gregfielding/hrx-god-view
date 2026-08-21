/**
 * Claude-backed drop-in for the OpenAI `chat.completions.create` call
 * shape (Greg 2026-08-21: "switch from openai to claude in our app").
 *
 * Every server-side LLM call in HRX was written against
 * `openai.chat.completions.create({ model, messages, response_format,
 * max_completion_tokens, temperature })` → `choices[0].message.content`.
 * Rather than rewrite ~40 call sites, this adapter speaks that exact
 * shape and runs on the Anthropic Messages API underneath, so a file
 * migrates by swapping ONE line: `new OpenAI(...)` → `getClaudeChat()`.
 * Unit tests that inject a mock client with the same shape keep working.
 *
 * Mapping:
 *   - `model`            → ignored; always CLAUDE_MODEL (default claude-opus-5).
 *   - system messages    → Messages API `system`; user/assistant → `messages`.
 *   - `response_format: json_object` → strict "JSON object only" instruction
 *                           + code-fence stripping + JSON validation (the
 *                           callers all do tolerant parsing of `content`).
 *   - `max_completion_tokens`/`max_tokens` → `max_tokens` (floor 4096 —
 *                           adaptive thinking shares the cap with output).
 *   - `temperature`/`top_p` → dropped (Opus 5 rejects sampling params).
 *   - refusal            → thrown Error (callers already try/catch + fallback).
 *   - server-side refusal fallbacks ON (`fallbacks: 'default'`).
 * Adaptive thinking at effort `medium` — these are extraction/drafting
 * tasks; CLAUDE_EFFORT env overrides globally.
 */
import Anthropic from '@anthropic-ai/sdk';

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5';
const EFFORT = (process.env.CLAUDE_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

type ChatRole = 'system' | 'user' | 'assistant' | 'developer';
type ChatContentPart = { type: 'text'; text: string } | { type: string; [k: string]: unknown };
export interface ChatMessageLike {
  role: ChatRole;
  content: string | ChatContentPart[] | null;
}
export interface ChatCompletionParamsLike {
  model?: string;
  messages: ChatMessageLike[];
  response_format?: { type: 'json_object' | 'text' | string; [k: string]: unknown };
  max_completion_tokens?: number;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  [k: string]: unknown;
}
export interface ChatCompletionLike {
  id: string;
  model: string;
  choices: Array<{ index: number; message: { role: 'assistant'; content: string | null }; finish_reason: string }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}
export interface ChatClientLike {
  chat: { completions: { create(params: ChatCompletionParamsLike): Promise<ChatCompletionLike> } };
}

const JSON_INSTRUCTION =
  'Output format: respond with a single valid JSON object and nothing else — no prose before or after, no markdown code fences.';

function partText(content: ChatMessageLike['content']): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .map((p) => (p && typeof p === 'object' && p.type === 'text' ? String((p as { text: string }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}

/** Strip ```json fences and leading/trailing prose around the outermost JSON value. */
export function extractJsonText(raw: string): string {
  let s = String(raw ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  if (!(s.startsWith('{') || s.startsWith('['))) {
    const start = Math.min(...['{', '['].map((c) => s.indexOf(c)).filter((i) => i >= 0));
    if (Number.isFinite(start)) s = s.slice(start);
  }
  const lastBrace = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (lastBrace > 0) s = s.slice(0, lastBrace + 1);
  return s;
}

let cachedClient: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY unset');
    cachedClient = new Anthropic({ apiKey, maxRetries: 2 });
  }
  return cachedClient;
}

export async function createChatCompletion(params: ChatCompletionParamsLike): Promise<ChatCompletionLike> {
  const client = getAnthropic();
  const wantsJson = params.response_format?.type === 'json_object';
  const systemParts: string[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of params.messages ?? []) {
    const text = partText(m.content);
    if (m.role === 'system' || m.role === 'developer') {
      if (text) systemParts.push(text);
    } else if (m.role === 'user' || m.role === 'assistant') {
      if (text) messages.push({ role: m.role, content: text });
    }
  }
  if (wantsJson) systemParts.push(JSON_INSTRUCTION);
  if (messages.length === 0 || messages[0].role !== 'user') {
    // Messages API requires the first turn to be user; some callers put
    // everything in `system`. Give the model an explicit user turn.
    messages.unshift({ role: 'user', content: wantsJson ? 'Produce the JSON object now.' : 'Proceed.' });
  }
  const requested = Number(params.max_completion_tokens ?? params.max_tokens ?? 0);
  const max_tokens = Math.max(4096, Number.isFinite(requested) ? requested : 0);

  const response = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens,
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    messages,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });

  if (response.stop_reason === 'refusal') {
    const details = response.stop_details as { category?: string; explanation?: string } | null | undefined;
    throw new Error(`Claude refused (${details?.category ?? 'unknown'}): ${details?.explanation ?? ''}`.trim());
  }
  let content = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  if (wantsJson) {
    const candidate = extractJsonText(content);
    JSON.parse(candidate); // throws on invalid JSON — callers expect parseable content
    content = candidate;
  }
  const usage = response.usage;
  return {
    id: response.id,
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: response.stop_reason === 'max_tokens' ? 'length' : 'stop',
      },
    ],
    usage: {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens,
    },
  };
}

let cachedChat: ChatClientLike | null = null;
/** OpenAI-shaped client backed by Claude. Lazy — safe at module top level. */
export function getClaudeChat(): ChatClientLike {
  if (!cachedChat) cachedChat = { chat: { completions: { create: createChatCompletion } } };
  return cachedChat;
}
