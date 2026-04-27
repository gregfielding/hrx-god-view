/**
 * Translate missing keys in es.json using OpenAI. Run offline as a dev helper.
 * Preserves placeholders like {count}, {name}. Requires OPENAI_API_KEY.
 * Usage: npx ts-node scripts/i18n/translate-missing.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const LOCALES_DIR = path.join(ROOT, 'i18n', 'locales');

function allKeysWithValues(
  obj: Record<string, unknown>,
  prefix = ''
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      out.push(...allKeysWithValues(value as Record<string, unknown>, fullKey));
    } else if (typeof value === 'string') {
      out.push({ key: fullKey, value });
    }
  }
  return out;
}

function setByPath(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const parts = keyPath.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!(p in cur) || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

async function translateWithOpenAI(text: string, openaiKey: string): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey: openaiKey });
  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a translator. Translate the following English UI string into Spanish (es). Keep placeholders exactly as given, e.g. {count}, {name}. Return only the translation, no explanation.',
      },
      { role: 'user', content: text },
    ],
    max_tokens: 500,
  });
  const content = resp.choices[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty OpenAI response');
  return content;
}

async function main(): Promise<void> {
  const enPath = path.join(LOCALES_DIR, 'en.json');
  const esPath = path.join(LOCALES_DIR, 'es.json');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Set OPENAI_API_KEY to run translate-missing.');
    process.exit(1);
  }
  if (!fs.existsSync(enPath) || !fs.existsSync(esPath)) {
    console.error('Missing i18n/locales/en.json or es.json');
    process.exit(1);
  }

  const en = JSON.parse(fs.readFileSync(enPath, 'utf-8')) as Record<string, unknown>;
  const es = JSON.parse(fs.readFileSync(esPath, 'utf-8')) as Record<string, unknown>;
  const enEntries = allKeysWithValues(en);
  const esKeySet = new Set(allKeysWithValues(es).map((e) => e.key));

  const missing = enEntries.filter((e) => !esKeySet.has(e.key));
  if (missing.length === 0) {
    console.log('No missing keys in es.json.');
    return;
  }

  console.log(`Translating ${missing.length} missing key(s)...`);
  for (const { key, value } of missing) {
    try {
      const translated = await translateWithOpenAI(value, apiKey);
      setByPath(es, key, translated);
      console.log(`  ${key}`);
    } catch (err) {
      console.error(`  Failed ${key}:`, (err as Error).message);
    }
  }

  fs.writeFileSync(esPath, JSON.stringify(es, null, 2) + '\n', 'utf-8');
  console.log('Updated es.json.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
