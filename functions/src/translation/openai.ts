/**
 * Batch EN→ES translation via OpenAI. Preserves placeholders; respects glossary and doNotTranslate.
 */

import type OpenAI from 'openai';
import type { TranslationSettings } from './types';

export interface TranslateBatchItem {
  key: string;
  text: string;
}

export interface TranslateBatchResult {
  items: Array<{ key: string; translated: string }>;
}

const DEFAULT_MODEL = 'gpt-4o-mini';

function buildSystemPrompt(): string {
  return [
    'You are a professional localization engine.',
    'Translate English to neutral Latin American Spanish.',
    'Preserve placeholders exactly (e.g. {{firstName}}, {count}, %s).',
    'Respect the glossary and do-not-translate list.',
    'Return JSON only, with schema: { "items": [ { "key": "<fieldPath>", "translated": "<text>" } ] }.',
  ].join('\n');
}

export async function translateBatchEnToEs(params: {
  client: OpenAI;
  items: TranslateBatchItem[];
  settings: TranslationSettings;
  model?: string;
}): Promise<TranslateBatchResult> {
  const { client, items, settings, model = DEFAULT_MODEL } = params;

  const payload = {
    items,
    glossary: settings.glossary ?? {},
    doNotTranslate: settings.doNotTranslate ?? [],
    tone: settings.tone ?? 'neutral',
  };

  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    response_format: { type: 'json_object' },
  });

  const text = res.choices?.[0]?.message?.content ?? '{}';
  let json: { items?: Array<{ key?: string; translated?: string }> };
  try {
    json = JSON.parse(text) as { items?: Array<{ key?: string; translated?: string }> };
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 200)}`);
  }

  if (!json.items || !Array.isArray(json.items)) {
    throw new Error(`OpenAI response missing items array: ${text.slice(0, 200)}`);
  }

  return {
    items: json.items.map((item) => ({
      key: String(item.key ?? ''),
      translated: String(item.translated ?? ''),
    })),
  };
}
