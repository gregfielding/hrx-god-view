// Minimal OpenAI JSON-schema caller (server-friendly). For web, prefer routing through a backend.
import OpenAI from 'openai';

type JsonSchema = Record<string, any>;

export type OpenAIJsonParams = {
  apiKey?: string;
  model: string;
  temperature?: number;
  system: string;
  developer?: string;
  user: string;
  jsonSchema: JsonSchema;
  maxTokens?: number;
};

export async function openAIJson<T = any>(p: OpenAIJsonParams): Promise<T> {
  const client = new OpenAI({ apiKey: p.apiKey ?? (typeof process !== 'undefined' ? (process as any).env?.OPENAI_API_KEY : undefined) });

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [
    { role: 'system', content: p.system },
    ...(p.developer ? ([{ role: 'system', content: `[Developer] ${p.developer}` }] as Array<{ role: 'system'; content: string }>) : []),
    { role: 'user', content: p.user }
  ];

  const resp = await client.chat.completions.create({
    model: p.model,
    temperature: p.temperature ?? 0.2,
    max_tokens: p.maxTokens,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'Response', schema: p.jsonSchema, strict: true }
    } as any
  } as any);

  const content: any = resp?.choices?.[0]?.message?.content ?? '';
  if (typeof content === 'string') {
    try { return JSON.parse(content) as T; } catch (e) { throw new Error('JSON parse failed for OpenAI JSON response'); }
  }
  return content as T;
}


