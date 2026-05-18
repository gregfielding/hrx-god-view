/**
 * Everee HTTP — single point of contact for every outbound request to
 * Everee's API surfaces.
 *
 * **Two API surfaces, one helper.** Callers pass a full path; the helper
 * is intentionally surface-agnostic so the same auth + error pipeline
 * applies to both:
 *
 *   - `/api/v2/...`           → Workers, Embedded Sessions, Pay Codes,
 *                                Work Locations, Payables, Onboarding.
 *   - `/integration/v1/...`   → Approval Groups, Timesheets (Worked
 *                                Shifts, Classified Hours Bulk).
 *
 * **Stub mode.** When the entity's API token is unset or matches the
 * sentinel `stub-no-token-configured`, requests short-circuit through
 * `stubResponse` so emulator + test environments don't need live Everee
 * credentials. See `evereeAuth.getEvereeHeaders`.
 *
 * **Rate-limit handling (TS.1.P4 Slice 1).** Everee enforces 200 ops /
 * 5-second sliding window per company instance (reads + writes
 * combined). On 429, this helper performs **a single retry** based on
 * the server-supplied `RateLimit-Reset` header (Unix epoch seconds),
 * plus a small jitter to avoid thundering-herd retries from concurrent
 * Cloud Tasks workers. After a second 429 — or when no usable
 * `RateLimit-Reset` is returned, or the suggested wait exceeds
 * {@link RATE_LIMIT_MAX_WAIT_MS} — the error is thrown verbatim so the
 * orchestrator's Cloud Tasks queue can handle the next retry with its
 * own exponential backoff. This split avoids stalling a single worker
 * on a multi-minute reset.
 */

import { logger } from 'firebase-functions/v2';

import { getEvereeHeaders } from './evereeAuth';
import type { EvereeEntityConfig } from './evereeConfig';

const STUB_TOKEN = 'stub-no-token-configured';

/**
 * Maximum we'll sleep on a single in-process 429 retry. If Everee's
 * `RateLimit-Reset` suggests longer than this, we throw and let the
 * caller's Cloud Tasks queue reschedule — a single Cloud Function
 * blocking for minutes is worse than a queued retry.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 30 * 1000;

/**
 * Floor on the sleep duration. Some servers send a `RateLimit-Reset`
 * that's already in the past (clock skew); we still want a small
 * gap before retrying to give the rolling window a chance to advance.
 */
const RATE_LIMIT_MIN_WAIT_MS = 100;

/**
 * Public API. Same signature as before; behavior is unchanged for
 * non-429 paths.
 *
 * `path` is taken verbatim — callers pass either `/api/v2/...` or
 * `/integration/v1/...` exactly. The helper does NOT auto-prefix.
 */
export async function evereeRequest<T>(
  config: EvereeEntityConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return requestWithRetry<T>(config, method, path, body, 0);
}

async function requestWithRetry<T>(
  config: EvereeEntityConfig,
  method: string,
  path: string,
  body: unknown,
  retryCount: number,
): Promise<T> {
  const headers = await getEvereeHeaders(config);
  const auth = headers.authorization ?? '';
  const token = auth.replace(/^Basic\s+/i, '');
  const decoded = token ? Buffer.from(token, 'base64').toString('utf8') : '';
  if (decoded === STUB_TOKEN || !decoded) {
    return stubResponse(method, path) as T;
  }
  // Everee uses a single API host for both sandbox + prod (env separation
  // is enforced by the per-tenant API token, not the hostname). Keep the
  // entity-config override as the primary; fall back to the canonical host.
  const base = config.evereeApiBaseUrl ?? 'https://api.everee.com';
  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: { ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 429 && retryCount === 0) {
    const waitMs = computeRateLimitWaitMs(res);
    if (waitMs !== null) {
      logger.warn('[evereeRequest] 429 rate-limited; retrying after Everee-suggested wait', {
        path,
        method,
        waitMs,
      });
      await sleep(waitMs);
      return requestWithRetry<T>(config, method, path, body, retryCount + 1);
    }
    // Fall through to the standard error throw — no usable header, or
    // suggested wait exceeds the in-process cap.
    logger.warn(
      '[evereeRequest] 429 rate-limited; not retrying (no usable RateLimit-Reset or wait exceeds cap)',
      {
        path,
        method,
        resetHeader: res.headers.get('RateLimit-Reset') ?? res.headers.get('ratelimit-reset'),
      },
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Everee API ${method} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Parse the `RateLimit-Reset` header (Unix epoch seconds per RFC 6585 +
 * draft-ietf-httpapi-ratelimit-headers; Everee follows that spec) into
 * a wait duration in milliseconds, clamped to a safe window. Returns
 * `null` when the header is missing, malformed, or suggests a wait
 * longer than {@link RATE_LIMIT_MAX_WAIT_MS}.
 *
 * Adds jitter up to 1s to avoid concurrent Cloud Tasks workers all
 * retrying in the same millisecond after the reset.
 */
export function computeRateLimitWaitMs(res: Response, now: number = Date.now()): number | null {
  const raw = res.headers.get('RateLimit-Reset') ?? res.headers.get('ratelimit-reset');
  if (!raw) return null;
  const resetEpochSec = parseInt(raw, 10);
  if (!Number.isFinite(resetEpochSec) || resetEpochSec <= 0) return null;
  const targetMs = resetEpochSec * 1000;
  const jitterMs = Math.floor(Math.random() * 1000);
  const rawWaitMs = targetMs - now + jitterMs;
  // Floor + cap. If reset is already in the past, still wait the floor
  // so the next request lands on the fresh window.
  if (rawWaitMs <= 0) return RATE_LIMIT_MIN_WAIT_MS;
  if (rawWaitMs > RATE_LIMIT_MAX_WAIT_MS) return null;
  return Math.max(rawWaitMs, RATE_LIMIT_MIN_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stubResponse(method: string, path: string): unknown {
  if (path.includes('ping') || path.endsWith('/tenants/me')) return { ok: true };
  if (
    method === 'POST' &&
    (path.includes('/embedded/workers/') ||
      path.includes('/onboarding/contractor') ||
      path.includes('/workers'))
  ) {
    return { workerId: 'stub-worker-id', id: 'stub-worker-id' };
  }
  if (path.includes('embed') && method === 'POST')
    return {
      url: 'https://stub.everee.com/embed/onboarding',
      origin: 'https://stub.everee.com',
      expiresInMs: 3600000,
      sessionId: 'stub-session-id',
    };
  return {};
}
