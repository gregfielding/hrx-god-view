/**
 * E-Verify HTTP wrapper: retries, timeouts.
 * ICA v31 Refactor Pack §4.1
 */

export type HttpOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export async function httpJson<T>(opts: HttpOptions): Promise<T> {
  const {
    method,
    url,
    headers = {},
    body,
    timeoutMs = 15000,
    retries = 2,
  } = opts;

  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(id);

      const text = await resp.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // non-JSON response
      }

      if (resp.ok) return json as T;

      if ((resp.status >= 500 || resp.status === 429) && attempt <= retries) {
        await sleep(250 * attempt);
        continue;
      }

      const err = new Error(`HTTP ${resp.status}`);
      const enriched = err as Error & {
        status?: number;
        body?: unknown;
        responseText?: string;
      };
      enriched.status = resp.status;
      enriched.body = json;
      enriched.responseText = text;
      throw err;
    } catch (e: unknown) {
      clearTimeout(id);
      const st = (e as Error & { status?: number }).status;
      // Do not retry client errors (except 429 handled above with continue).
      if (typeof st === 'number' && st >= 400 && st < 500 && st !== 429) {
        throw e;
      }
      lastErr = e;
      if (attempt <= retries) {
        await sleep(250 * attempt);
        continue;
      }
      throw lastErr;
    }
  }

  throw lastErr;
}

/** Best-effort detail for USCIS / OAuth error JSON or plain-text bodies (no PII from our request). */
export function summarizeHttpErrorBody(err: unknown): string {
  const e = err as Error & { status?: number; body?: unknown; responseText?: string };
  const status = e.status != null ? String(e.status) : '';
  const body = e.body;
  let detail = '';
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    const msg =
      (typeof o.message === 'string' && o.message) ||
      (typeof o.error_description === 'string' && o.error_description) ||
      (typeof o.error === 'string' && o.error) ||
      (typeof o.detail === 'string' && o.detail) ||
      (typeof o.title === 'string' && o.title);
    if (msg) detail = msg;
    else detail = JSON.stringify(body).slice(0, 900);
  } else if (e.responseText && e.responseText.trim()) {
    detail = e.responseText.trim().slice(0, 900);
  } else {
    detail = e.message || '';
  }
  return [status, detail].filter(Boolean).join(' — ');
}
