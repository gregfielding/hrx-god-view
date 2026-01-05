import { CallableCache } from './callableCache';

type EmailThreadCacheKey = string;

export type EmailThreadApiResult = {
  success: boolean;
  thread?: any;
  messages?: any[];
  error?: string;
};

const MEMORY_TTL_MS = 2 * 60 * 1000; // 2 minutes (fast reopen + hover prefetch)
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes (survives hot reload)
const SESSION_KEY_PREFIX = 'emailThread.cache.v1:';

const memoryCache = new CallableCache(MEMORY_TTL_MS);

function makeKey(tenantId: string, threadId: string, limit: number): EmailThreadCacheKey {
  return `${tenantId}:${threadId}:limit=${limit}`;
}

function readSession(key: EmailThreadCacheKey): { at: number; data: EmailThreadApiResult } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== 'number' || !parsed.data) return null;
    if (Date.now() - parsed.at > SESSION_TTL_MS) return null;
    return parsed as { at: number; data: EmailThreadApiResult };
  } catch {
    return null;
  }
}

function writeSession(key: EmailThreadCacheKey, data: EmailThreadApiResult) {
  try {
    sessionStorage.setItem(
      SESSION_KEY_PREFIX + key,
      JSON.stringify({ at: Date.now(), data }),
    );
  } catch {}
}

export function peekEmailThread(tenantId: string, threadId: string, limit = 50): EmailThreadApiResult | null {
  const key = makeKey(tenantId, threadId, limit);
  const hit = readSession(key);
  return hit?.data ?? null;
}

export function invalidateEmailThread(tenantId: string, threadId: string, limit = 50) {
  const key = makeKey(tenantId, threadId, limit);
  memoryCache.invalidate(key);
  try {
    sessionStorage.removeItem(SESSION_KEY_PREFIX + key);
  } catch {}
}

export async function fetchEmailThreadCached(options: {
  tenantId: string;
  threadId: string;
  limit?: number;
  force?: boolean;
  apiBaseUrl?: string;
}): Promise<EmailThreadApiResult> {
  const { tenantId, threadId, limit = 50, force = false, apiBaseUrl } = options;
  const key = makeKey(tenantId, threadId, limit);

  if (force) {
    invalidateEmailThread(tenantId, threadId, limit);
  }

  // Serve from session immediately if present (memory cache will coalesce the real fetch)
  const sessionHit = readSession(key);
  if (sessionHit && !force) {
    // Also schedule a refresh in the background (non-blocking)
    void memoryCache.getOrFetch(key, async () => {
      const data = await fetchEmailThreadNetwork({ tenantId, threadId, limit, apiBaseUrl });
      writeSession(key, data);
      return data;
    });
    return sessionHit.data;
  }

  const result = await memoryCache.getOrFetch(key, async () => {
    const data = await fetchEmailThreadNetwork({ tenantId, threadId, limit, apiBaseUrl });
    writeSession(key, data);
    return data;
  });

  return result;
}

async function fetchEmailThreadNetwork(options: {
  tenantId: string;
  threadId: string;
  limit: number;
  apiBaseUrl?: string;
}): Promise<EmailThreadApiResult> {
  const { tenantId, threadId, limit, apiBaseUrl } = options;

  const API_BASE_URL =
    apiBaseUrl ||
    process.env.REACT_APP_FUNCTIONS_URL ||
    'https://us-central1-hrx1-d3beb.cloudfunctions.net';

  const url = `${API_BASE_URL}/getEmailThreadApi?threadId=${encodeURIComponent(threadId)}&tenantId=${encodeURIComponent(tenantId)}&limit=${encodeURIComponent(String(limit))}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Failed to load email thread: ${response.status} ${response.statusText} ${errorText}` };
    }

    return (await response.json()) as EmailThreadApiResult;
  } catch (error: any) {
    // Handle network errors (Failed to fetch, CORS, etc.)
    const errorMessage = error?.message || 'Network error';
    return { 
      success: false, 
      error: `Failed to fetch email thread: ${errorMessage}` 
    };
  }
}


