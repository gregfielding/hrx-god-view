import { MemoryCache, stableHash, chooseTTL } from './cache';

type AIParams = {
  model: string;
  temperature?: number;
  system: string;
  developer?: string;
  user: string;
  schemaVersion?: string;
  locale?: string;
  userId?: string;
  allowCache?: boolean;
  maxTokens?: number;
};

type AIResponse<T = any> =
  | { ok: true; data: T; fromCache: boolean; cacheKey?: string }
  | { ok: false; error: string };

const cache = new MemoryCache();

async function callOpenAIRaw(params: AIParams): Promise<any> {
  // Simple passthrough to our gateway so we centralize server tokens and guardrails
  const res = await fetch('https://us-central1-hrx1-d3beb.cloudfunctions.net/chatWithGPT', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: params.userId || 'anon',
      userId: params.userId || 'anon',
      threadId: 'cache-probe',
      messages: [
        { role: 'system', content: params.system },
        ...(params.developer ? [{ role: 'system', content: `[Dev] ${params.developer}` }] : []),
        { role: 'user', content: params.user }
      ],
      toolMode: false
    })
  });
  if (!res.ok) throw new Error(`Gateway error ${res.status}`);
  const data = await res.json();
  return data?.reply ?? '';
}

export async function aiCall<T = any>(p: AIParams): Promise<AIResponse<T>> {
  const signature = {
    model: p.model,
    temperature: p.temperature ?? 0.2,
    system: p.system,
    developer: p.developer ?? '',
    user: p.user,
    schemaVersion: p.schemaVersion ?? 'v1',
    locale: p.locale ?? 'en-US',
    userId: p.userId ?? ''
  };
  const cacheKey = 'ai:' + stableHash(signature);
  const ttl = chooseTTL(p.temperature ?? 0.2, p.allowCache !== false);

  if (ttl > 0) {
    const cached = await cache.get<T>(cacheKey);
    if (cached) return { ok: true, data: cached, fromCache: true, cacheKey };
  }

  const start = Date.now();
  try {
    const raw = await callOpenAIRaw(p);
    const result = raw as unknown as T;
    if (ttl > 0) await cache.set(cacheKey, result, ttl);
    void start; // reserved for metrics
    return { ok: true, data: result, fromCache: false, cacheKey };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}


