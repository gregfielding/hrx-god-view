import OpenAI from 'openai';
import { getOpenAIKey } from './secrets';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

export interface EmbeddingResult {
  model: string;
  vector: number[];
  dims: number;
}

export async function generateEmbedding(input: string): Promise<EmbeddingResult | undefined> {
  const enabled = (process.env.ENRICHMENT_EMBEDDINGS_ENABLED || 'false') === 'true';
  if (!enabled) return undefined;
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const text = (input || '').slice(0, 8000);
  if (!text.trim()) return undefined;
  if (!(openai as any).apiKey) {
    const k = await getOpenAIKey();
    if (k) (openai as any).apiKey = k;
  }
  const resp = await openai.embeddings.create({ model, input: text });
  const data = resp.data?.[0]?.embedding as number[] | undefined;
  if (!data) return undefined;
  return { model, vector: data, dims: data.length };
}


