import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Resolve the OpenAI API key with fallbacks:
 * 1) process.env.OPENAI_API_KEY
 * 2) tenants/{tenantId}/aiSettings/openai.apiKey
 * 3) appAiSettings/openai.apiKey
 * 4) modules/ai-chat.openaiApiKey or modules/ai-chat.apiKey
 */
export async function getOpenAIKey(tenantId?: string): Promise<string | undefined> {
  if (process.env.OPENAI_API_KEY) return String(process.env.OPENAI_API_KEY).trim();

  try {
    if (tenantId) {
      const tDoc = await db.collection('tenants').doc(tenantId).collection('aiSettings').doc('openai').get();
      const t = tDoc.exists ? (tDoc.data() as any) : undefined;
      const tKey = t?.apiKey || t?.openaiApiKey || t?.key;
      if (tKey) return String(tKey).trim();
    }
  } catch {}

  try {
    const appDoc = await db.collection('appAiSettings').doc('openai').get();
    const a = appDoc.exists ? (appDoc.data() as any) : undefined;
    const aKey = a?.apiKey || a?.openaiApiKey || a?.key;
    if (aKey) return String(aKey).trim();
  } catch {}

  try {
    const modDoc = await db.collection('modules').doc('ai-chat').get();
    const data = modDoc.exists ? (modDoc.data() as any) : undefined;
    const mKey = data?.openaiApiKey || data?.apiKey || data?.key;
    if (mKey) return String(mKey).trim();
  } catch {}

  return undefined;
}

// Clearbit key resolver mirroring OpenAI
export async function getClearbitKey(tenantId?: string): Promise<string | undefined> {
  if (process.env.CLEARBIT_API_KEY) return process.env.CLEARBIT_API_KEY;

  try {
    if (tenantId) {
      const tDoc = await db.collection('tenants').doc(tenantId).collection('aiSettings').doc('clearbit').get();
      const tKey = tDoc.exists ? (tDoc.data() as any)?.apiKey : undefined;
      if (tKey) return tKey;
    }
  } catch {}

  try {
    const appDoc = await db.collection('appAiSettings').doc('clearbit').get();
    const aKey = appDoc.exists ? (appDoc.data() as any)?.apiKey : undefined;
    if (aKey) return aKey;
  } catch {}

  return undefined;
}

// Apollo key resolver
export async function getApolloKey(tenantId?: string): Promise<string | undefined> {
  // Prefer environment variable first (set via Functions config or .env)
  const envVal = process.env.APOLLO_API_KEY as string | undefined;
  if (envVal) {
    // Sanitize to avoid illegal header characters (remove whitespace and any non ASCII token chars)
    const cleaned = String(envVal)
      .replace(/[\r\n\t ]+/g, '')
      .replace(/[^A-Za-z0-9_.-]/g, '');
    return cleaned;
  }

  try {
    if (tenantId) {
      const tDoc = await db.collection('tenants').doc(tenantId).collection('aiSettings').doc('apollo').get();
      const tKey = tDoc.exists ? (tDoc.data() as any)?.apiKey : undefined;
      if (tKey) return tKey;
    }
  } catch {}

  try {
    // Soft deprecate app-level Firestore storage for API keys to avoid persistence
    const appDoc = await db.collection('appAiSettings').doc('apollo').get();
    const aKey = appDoc.exists ? (appDoc.data() as any)?.apiKey : undefined;
    if (aKey) return String(aKey).replace(/[\r\n\t ]+/g, '').replace(/[^A-Za-z0-9_.-]/g, '');
  } catch {}

  return undefined;
}


