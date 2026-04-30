/**
 * Defense-in-depth assertion for Everee fetch sites.
 *
 * Why this exists (EE.1, Apr 2026):
 *   A debug-button output looked like a closure-in-loop bug — two console
 *   blocks both labeled with the C1 Events tenant×worker pair, but with
 *   different response bodies (one was C1 Select W-2 data, one was C1 Events
 *   1099 data). On audit, the actual root cause was a wrong link-doc filter
 *   in `UserProfile/index.tsx::handleFetchEvereeApiData`, not a closure
 *   bug. But the principle stands: any future site that fans out an Everee
 *   fetch over multiple `(evereeTenantId, evereeWorkerId)` pairs is one
 *   sloppy refactor away from leaking the wrong worker's data into the wrong
 *   tab. This helper makes that mistake fail loudly with a stack trace,
 *   instead of silently rendering wrong PII.
 *
 * What it does:
 *   - Reads the `evereeWorkerId` echoed back by the server callable
 *     (`EvereeAdminGetWorkerResult.evereeWorkerId`) AND the `workerId`/`id`
 *     in the raw Everee API response, and compares both against the value
 *     the caller meant to fetch.
 *   - Logs `console.error` with full pairing context on any mismatch — the
 *     Sentry / log capture in the browser will surface it.
 *   - Returns a boolean so callers can skip rendering / suppress further
 *     state writes when the response doesn't match what was requested.
 *
 * Out of scope:
 *   - This does not throw; rendering wrong-tenant PII is bad but throwing
 *     mid-render is worse. Callers decide what to do with the boolean.
 *   - It does not validate `evereeTenantId` echoes — that's a useful
 *     additional check but the API response shape doesn't always carry it,
 *     and the server's `evereeTenantId` echo is derived from entity config,
 *     not from the response itself. Add a separate helper if needed.
 */

/* eslint-disable no-console */

export interface AssertEvereeWorkerIdMatchArgs {
  /** What the caller asked for — the value we want to verify against the response. */
  expectedEvereeWorkerId: string;
  /**
   * The `EvereeAdminGetWorkerResult.evereeWorkerId` echoed back by the
   * server callable. When the callable doesn't echo (e.g. tax-form
   * callables that only return `{ ok, applicable, response }`), pass
   * `undefined` and the helper will skip the server-echo check.
   */
  serverEchoEvereeWorkerId?: string | null | undefined;
  /**
   * The raw Everee API response (or its unwrapped `.response` / `.worker`
   * payload). The helper looks for `workerId` then `id` on the response.
   * Pass `null`/`undefined` to skip the response-body check.
   */
  responseBody?: unknown;
  /** Free-form context for log correlation (call site, tenant, entity). */
  context: Record<string, unknown>;
}

export interface AssertEvereeWorkerIdMatchResult {
  ok: boolean;
  /** Why we returned false. `'no_response'` means we couldn't tell — call site should treat as ok. */
  reason:
    | 'match'
    | 'server_echo_mismatch'
    | 'response_body_mismatch'
    | 'expected_missing'
    | 'no_response';
}

function pickWorkerIdFromResponseBody(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Everee sometimes wraps the worker in `{ worker: {...} }` or `{ data: {...} }`.
  // Match the same defensive unwrap pattern used by `EmployeePayrollSection.pickWorker`.
  const candidate =
    (r.worker && typeof r.worker === 'object' ? (r.worker as Record<string, unknown>) : null) ||
    (r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : null) ||
    r;
  if (typeof candidate.workerId === 'string' && candidate.workerId.trim()) {
    return candidate.workerId.trim();
  }
  if (typeof candidate.id === 'string' && candidate.id.trim()) {
    return candidate.id.trim();
  }
  return null;
}

export function assertEvereeWorkerIdMatch(
  args: AssertEvereeWorkerIdMatchArgs,
): AssertEvereeWorkerIdMatchResult {
  const expected = (args.expectedEvereeWorkerId || '').trim();
  if (!expected) {
    console.error('[everee] assertEvereeWorkerIdMatch — expected workerId is empty', args.context);
    return { ok: false, reason: 'expected_missing' };
  }

  const serverEchoRaw = args.serverEchoEvereeWorkerId;
  if (typeof serverEchoRaw === 'string' && serverEchoRaw.trim()) {
    const serverEcho = serverEchoRaw.trim();
    if (serverEcho !== expected) {
      console.error('[everee] workerId mismatch — server echo disagrees with request', {
        ...args.context,
        expectedEvereeWorkerId: expected,
        serverEchoEvereeWorkerId: serverEcho,
      });
      return { ok: false, reason: 'server_echo_mismatch' };
    }
  }

  if (args.responseBody !== undefined && args.responseBody !== null) {
    const apiWorkerId = pickWorkerIdFromResponseBody(args.responseBody);
    if (apiWorkerId && apiWorkerId !== expected) {
      console.error('[everee] workerId mismatch — Everee API response body disagrees with request', {
        ...args.context,
        expectedEvereeWorkerId: expected,
        responseWorkerId: apiWorkerId,
      });
      return { ok: false, reason: 'response_body_mismatch' };
    }
    if (!apiWorkerId && !serverEchoRaw) {
      // Nothing to verify against — neither echo present. Silently allow.
      return { ok: true, reason: 'no_response' };
    }
  }

  return { ok: true, reason: 'match' };
}

/* eslint-enable no-console */
