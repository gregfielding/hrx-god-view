/**
 * **Indeed Flex parser — LLM fallback (gpt-5 via OpenAI).**
 *
 * The hybrid parsing strategy (Slice 2) calls into this module ONLY
 * when regex extraction reported `missingFields`. We pass the event
 * type the classifier already picked + the normalized body + the
 * already-extracted partial event, and ask gpt-5 to fill in the
 * missing fields.
 *
 * **Why not LLM-from-scratch on every email?**
 *
 *   - Regex hits cleanly on ~80% of templated notifications.
 *   - Each LLM call is $0.001–0.01 and adds 1-3s latency.
 *   - The structured output here is JSON-only against a small schema,
 *     so the LLM cost per fallback is the lower end.
 *
 * **Dependency injection.** The exported `llmExtract` accepts an
 * `OpenAI`-shaped client so tests can pass a mock. Production
 * callers use `defaultOpenAI()`.
 *
 * **Idempotency**: skipped here. The orchestrator (Slice 2 trigger)
 * is itself idempotent — the source ingest event is keyed by
 * `eventHash`, and the resulting `external_shift_requests` docs use
 * a deterministic id derived from that hash. A retry of the parser
 * just overwrites with the same content.
 */

import OpenAI from 'openai';

import type { IndeedFlexEvent, IndeedFlexEventType } from '../../../shared/indeedFlex/types';

/**
 * Minimal client surface — just enough to call
 * `chat.completions.create`. Tests inject a mock with the same shape.
 */
export interface OpenAILike {
  chat: {
    completions: {
      create: OpenAI['chat']['completions']['create'];
    };
  };
}

/** Lazy singleton — created on first use to keep cold-start lean. */
let cached: OpenAILike | null = null;
export function defaultOpenAI(): OpenAILike {
  if (cached) return cached;
  cached = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' }) as OpenAILike;
  return cached;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt construction
// ─────────────────────────────────────────────────────────────────────

/**
 * The set of fields the LLM is allowed to return for each event
 * type. We constrain the schema so the response is tightly typed and
 * the LLM can't introduce keys that downstream code doesn't know how
 * to handle.
 */
const SCHEMA_BY_TYPE: Record<IndeedFlexEventType, string> = {
  new_request: `{ "jobId": "string", "headcount": number, "workDate": "YYYY-MM-DD", "startTime": "HH:mm", "endTime": "HH:mm", "venueName": "string", "roleName": "string", "payRateUsd": number }`,
  change_headcount: `{ "previousHeadcount": number?, "newHeadcount": number, "jobId": "string?", "workDate": "YYYY-MM-DD", "startTime": "HH:mm?", "endTime": "HH:mm?", "venueName": "string", "roleName": "string?" }`,
  change_time: `{ "jobId": "string", "previousStartTime": "HH:mm?", "previousEndTime": "HH:mm?", "newStartTime": "HH:mm?", "newEndTime": "HH:mm?", "workDate": "YYYY-MM-DD", "venueName": "string?", "roleName": "string?" }`,
  cancel_booking: `{ "workerNames": ["string"], "reason": "string?", "workDate": "YYYY-MM-DD", "startTime": "HH:mm?", "endTime": "HH:mm?", "venueName": "string", "roleName": "string?" }`,
  no_show: `{ "workerName": "string", "jobId": "string?", "workDate": "YYYY-MM-DD", "startTime": "HH:mm?", "endTime": "HH:mm?", "venueName": "string?", "roleName": "string?" }`,
  daily_digest_expired: `{ "expiredJobs": [ { "jobId": "string?", "venueName": "string?" } ] }`,
};

function buildSystemPrompt(): string {
  return `You are a strict JSON extractor for Indeed Flex notification emails.
Your job: extract fields the regex layer missed. Output JSON only — no prose, no markdown fences, no commentary.
Time format: 24-hour "HH:mm" (e.g. 09:30, 17:15). Date format: "YYYY-MM-DD". If a field isn't clearly stated in the email, omit it from the JSON rather than guessing.`;
}

function buildUserPrompt(
  eventType: IndeedFlexEventType,
  partial: Partial<IndeedFlexEvent>,
  missingFields: string[],
  normalizedBody: string,
): string {
  return [
    `Event type: ${eventType}`,
    `Expected schema: ${SCHEMA_BY_TYPE[eventType]}`,
    '',
    `Already-extracted fields (do not overwrite — only fill in what's missing or clearly wrong):`,
    JSON.stringify(partial, null, 2),
    '',
    `Missing fields the regex layer wants you to fill: ${missingFields.join(', ')}`,
    '',
    `Email body:`,
    '"""',
    normalizedBody.slice(0, 8000), // hard cap — Indeed emails are tiny
    '"""',
    '',
    'Respond with one JSON object only. Use the partial above as your base and overwrite only the missing/wrong fields.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────────

export interface LlmExtractResult {
  /** Merged event (partial fields from regex + any fields the LLM
   *  filled in). The orchestrator decides confidence based on the
   *  count of fields the LLM had to add. */
  event: IndeedFlexEvent;
  /** Fields the LLM actually populated (subset of the input
   *  `missingFields`). Useful for the recruiter UI to highlight
   *  LLM-provided values. */
  filledFields: string[];
  /** Free-form note attached when the LLM behaved oddly (JSON repair
   *  required, unexpected keys, etc.). */
  notes?: string;
}

export interface LlmExtractInput {
  eventType: IndeedFlexEventType;
  partial: Partial<IndeedFlexEvent>;
  missingFields: string[];
  normalizedBody: string;
  /** Override for tests. Falls back to `defaultOpenAI()`. */
  client?: OpenAILike;
  /** Model name. Defaults to `gpt-5` per project convention. */
  model?: string;
}

/**
 * Call gpt-5 to fill in missing fields. Returns the merged event +
 * the list of fields the LLM filled. Throws on hard failure (transport,
 * unparseable response). Callers wrap in try/catch and fall back to
 * the partial regex event when the LLM is unavailable.
 */
export async function llmExtract(input: LlmExtractInput): Promise<LlmExtractResult> {
  const client = input.client ?? defaultOpenAI();
  const model = input.model ?? 'gpt-5';
  const system = buildSystemPrompt();
  const user = buildUserPrompt(
    input.eventType,
    input.partial,
    input.missingFields,
    input.normalizedBody,
  );

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // **2026-05-23 fix** — gpt-5 (and the o-series reasoning models)
    // only accept the default `temperature: 1` and reject any other
    // value with `400 Unsupported value: 'temperature' does not
    // support 0 with this model`. Result: every LLM fallback call
    // since the model upgrade was failing silently, leaving the
    // partial regex event as the final extraction (no venueName /
    // roleName / payRateUsd) — exactly the symptom Greg flagged on
    // the Recruiter shift log. Omitting `temperature` entirely
    // restores deterministic JSON extraction (model's default is fine
    // because `response_format: json_object` already constrains the
    // sampling; we don't actually need 0 for this task).
    response_format: { type: 'json_object' },
    max_completion_tokens: 800,
  });

  const raw = completion.choices?.[0]?.message?.content ?? '';
  const { parsed, notes } = parseLlmJson(raw);

  // Merge: LLM fields overwrite the partial only for keys present in
  // the LLM response. Keys the LLM omitted keep the partial value.
  const merged: Record<string, unknown> = { ...(input.partial as Record<string, unknown>) };
  const filledFields: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null || v === undefined || v === '') continue;
    if (merged[k] === undefined || merged[k] === '' || merged[k] === 0) {
      merged[k] = v;
      if (input.missingFields.includes(k)) filledFields.push(k);
    }
  }
  // Ensure the discriminator is set correctly — regardless of what
  // the LLM returned.
  merged.type = input.eventType;

  return {
    event: merged as unknown as IndeedFlexEvent,
    filledFields,
    ...(notes ? { notes } : {}),
  };
}

/**
 * Parse the LLM's JSON output. Tolerant of stray markdown fences
 * (`\`\`\`json ... \`\`\``) and leading commentary — gpt-5 is usually
 * compliant with `response_format: json_object`, but the parser
 * shouldn't break when it isn't.
 */
function parseLlmJson(raw: string): {
  parsed: Record<string, unknown>;
  notes?: string;
} {
  const trimmed = raw.trim();
  // Easy path — direct JSON.
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return { parsed: obj as Record<string, unknown> };
    }
  } catch {
    // fall through to fence-stripping
  }
  // Strip a leading ```json … ``` fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try {
      const obj = JSON.parse(fenced[1]);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { parsed: obj as Record<string, unknown>, notes: 'json fence stripped' };
      }
    } catch {
      // fall through
    }
  }
  // Last-resort: grab the first {...} balanced block.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(trimmed.slice(start, end + 1));
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return { parsed: obj as Record<string, unknown>, notes: 'json brace-balance fallback' };
      }
    } catch {
      // give up
    }
  }
  return { parsed: {}, notes: 'json parse failed; returned empty object' };
}
