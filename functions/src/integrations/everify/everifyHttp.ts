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
      (err as Error & { status?: number; body?: unknown }).status = resp.status;
      (err as Error & { status?: number; body?: unknown }).body = json;
      throw err;
    } catch (e: unknown) {
      clearTimeout(id);
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
