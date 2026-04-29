/**
 * Everee service: worker, onboarding, pay history, shifts, payout (HRX Everee Master Plan §4).
 *
 * `createWorkerIfNeeded` is the first surface that makes a real outbound call to
 * the Everee sandbox; it intentionally logs request + response payloads under
 * structured Cloud Logging fields (`surface: 'everee.createWorker'`) while we
 * lock in the actual API contract. Once stable, downgrade the body logs to
 * debug or feature-flag them.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { getEvereeConfigForEntity, type EvereeEntityConfig } from './evereeConfig';
import { evereePaths } from './evereeConfig';
import { evereeRequest } from './evereeHttp';
import type { EvereePayHistoryItem, EvereePayStatementSummary } from './evereeSchemas';

export interface CreateWorkerInput {
  tenantId: string;
  entityId: string;
  userId: string;
  firebaseUid: string;
  workerType: 'employee' | 'contractor';
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  /**
   * Optional override — when set, skip `getEvereeConfigForEntity` and use the
   * provided config directly. Used by the temp sandbox-test callable so a
   * recruiter can fire `POST /v2/workers` without first wiring an entity doc
   * with `evereeTenantId` / `evereeEnabled` / `payrollProvider`. Production
   * callable (`evereeEnsureWorker`) never sets this.
   */
  _overrideConfig?: EvereeEntityConfig;
}

export interface CreateOnboardingSessionInput {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  returnUrl?: string;
}

/**
 * Create worker in Everee if not already linked; create/update everee_workers doc
 * AND mirror the new worker id onto `users/{firebaseUid}.evereeWorkerIds`.
 *
 * Multi-Everee-tenant model: every C1 entity points at its own Everee tenant
 * (Sandbox=2320, future Select=X, Events=Y, ...). A single HRX worker can
 * therefore accumulate multiple `evereeWorkerId`s — one per Everee tenant they
 * are provisioned in. We model this with a map on the user record:
 *   `users/{firebaseUid}.evereeWorkerIds = { [evereeTenantId]: workerId }`
 * `merge: true` on this map lets new entries land without disturbing existing
 * keys (other Everee tenants the worker is already linked to).
 *
 * Idempotency is two-layered:
 *   (1) Fast path: read `users/{firebaseUid}.evereeWorkerIds[evereeTenantId]`.
 *       Most repeat clicks resolve here without touching `everee_workers`.
 *   (2) Canonical fallback: read `everee_workers/{entityId}__{userId}` —
 *       still the source of truth, kept as belt-and-suspenders in case the
 *       user-record map ever drifts (e.g. partial writes, manual edits).
 * Either hit returns the existing id without re-POSTing to Everee.
 */
export async function createWorkerIfNeeded(input: CreateWorkerInput): Promise<{
  evereeWorkerId: string;
  created: boolean;
  /**
   * Debug payload — echoed back to the caller so a browser-console smoke test
   * surface can show the exact Everee API request/response without server log
   * access. Safe to remove once the integration is verified against the
   * sandbox; until then this is the cheapest way for a recruiter to validate
   * the API contract.
   */
  _debug?: {
    evereeTenantId: string;
    requestUrl: string;
    requestBody: unknown;
    responseBody?: unknown;
    durationMs?: number;
    skippedReason?: string;
  };
}> {
  const config =
    input._overrideConfig ?? (await getEvereeConfigForEntity(input.tenantId, input.entityId));
  if (!config) {
    throw new Error('Everee not configured for this entity');
  }
  const db = getFirestore();
  const linkRef = db.doc(evereePaths.worker(input.tenantId, input.entityId, input.userId));
  const userRef = db.doc(`users/${input.firebaseUid}`);
  const logCtx = {
    surface: 'everee.createWorker' as const,
    tenantId: input.tenantId,
    entityId: input.entityId,
    userId: input.userId,
    firebaseUid: input.firebaseUid,
    evereeTenantId: config.evereeTenantId,
  };

  // (1) Fast-path idempotency via the user-record map.
  try {
    const userSnap = await userRef.get();
    const userMap = (userSnap.data()?.evereeWorkerIds ?? null) as
      | Record<string, string>
      | null;
    const existingForTenant = userMap?.[config.evereeTenantId];
    if (existingForTenant) {
      logger.info('[everee.createWorker] skipping — user-map already linked', {
        ...logCtx,
        evereeWorkerId: existingForTenant,
        source: 'users.evereeWorkerIds',
      });
      return {
        evereeWorkerId: existingForTenant,
        created: false,
        _debug: {
          evereeTenantId: config.evereeTenantId,
          requestUrl: '(skipped — user-map fast path)',
          requestBody: null,
          skippedReason: 'user-map already linked',
        },
      };
    }
  } catch (err) {
    // Don't block on the fast-path read — fall through to the canonical check.
    logger.warn('[everee.createWorker] user-map fast-path read failed', {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // (2) Canonical idempotency via the linkage doc.
  const linkSnap = await linkRef.get();
  const existing = linkSnap.data() as { externalWorkerId?: string } | undefined;
  if (existing?.externalWorkerId) {
    logger.info('[everee.createWorker] skipping — linkage doc already linked', {
      ...logCtx,
      evereeWorkerId: existing.externalWorkerId,
      source: 'everee_workers',
    });
    // Backfill the user-record map so the next call hits the fast path.
    await mirrorEvereeWorkerIdToUser(userRef, config.evereeTenantId, existing.externalWorkerId, logCtx);
    return {
      evereeWorkerId: existing.externalWorkerId,
      created: false,
      _debug: {
        evereeTenantId: config.evereeTenantId,
        requestUrl: '(skipped — linkage doc fast path)',
        requestBody: null,
        skippedReason: 'linkage doc already linked',
      },
    };
  }

  // Body shape best-guess: most payroll APIs accept `externalId` as the partner-side
  // primary key. If Everee rejects this field, swap to `metadata.hrx_user_id` or
  // `customFields.hrxUserId`; the verbose logging below surfaces the response shape
  // so we can pivot quickly without another deploy round-trip.
  const requestBody = {
    tenantId: config.evereeTenantId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    workerType: input.workerType,
    externalId: input.firebaseUid,
  };
  const baseUrl = config.evereeApiBaseUrl ?? 'https://api.sandbox.everee.com';
  const fullUrl = `${baseUrl.replace(/\/$/, '')}/v2/workers`;

  logger.info('[everee.createWorker] outgoing', {
    ...logCtx,
    method: 'POST',
    url: fullUrl,
    headers: {
      authorization: 'Basic <redacted>',
      'x-everee-tenant-id': config.evereeTenantId,
      'content-type': 'application/json',
    },
    bodyKeys: Object.keys(requestBody),
    bodyJson: requestBody,
  });

  const startedAt = Date.now();
  let response: unknown;
  try {
    response = await evereeRequest<unknown>(config, 'POST', '/v2/workers', requestBody);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errAny = err as { message?: string; status?: number; responseBody?: unknown };
    logger.error('[everee.createWorker] error', {
      ...logCtx,
      durationMs,
      errorMessage: errAny?.message ?? String(err),
      errorStatus: errAny?.status,
      errorBody: errAny?.responseBody,
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;
  logger.info('[everee.createWorker] response', {
    ...logCtx,
    durationMs,
    status: 200,
    responseBodyJson: response,
  });

  const evereeWorkerId = extractEvereeWorkerId(response);
  if (!evereeWorkerId) {
    logger.error('[everee.createWorker] no worker id in response', {
      ...logCtx,
      responseBodyJson: response,
    });
    throw new Error(
      `Everee /v2/workers POST returned no worker ID. Response: ${JSON.stringify(response)}`,
    );
  }

  const nowIso = new Date().toISOString();
  await linkRef.set(
    {
      tenantId: input.tenantId,
      entityId: input.entityId,
      userId: input.userId,
      firebaseUid: input.firebaseUid,
      externalWorkerId: evereeWorkerId,
      evereeTenantId: config.evereeTenantId,
      evereeWorkerId,
      workerType: input.workerType,
      status: 'created',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    { merge: true }
  );

  // Mirror onto the user-record map. `merge: true` + map shape means a worker
  // already linked to a different Everee tenant gets a new entry added without
  // stomping the existing ones.
  await mirrorEvereeWorkerIdToUser(userRef, config.evereeTenantId, evereeWorkerId, logCtx);

  return {
    evereeWorkerId,
    created: true,
    _debug: {
      evereeTenantId: config.evereeTenantId,
      requestUrl: fullUrl,
      requestBody,
      responseBody: response,
      durationMs,
    },
  };
}

/**
 * Write `users/{firebaseUid}.evereeWorkerIds[evereeTenantId] = workerId`.
 * Best-effort: never fail the parent sync over a user-doc write.
 */
async function mirrorEvereeWorkerIdToUser(
  userRef: FirebaseFirestore.DocumentReference,
  evereeTenantId: string,
  evereeWorkerId: string,
  logCtx: Record<string, unknown>,
): Promise<void> {
  try {
    await userRef.set(
      {
        evereeWorkerIds: { [evereeTenantId]: evereeWorkerId },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    logger.info('[everee.createWorker] mirrored to users.evereeWorkerIds', {
      ...logCtx,
      evereeWorkerId,
    });
  } catch (err) {
    logger.error('[everee.createWorker] users.evereeWorkerIds mirror failed', {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Extract the worker id from an Everee `POST /v2/workers` response.
 * Order of preference reflects the most-likely shapes for payroll APIs; verify
 * against the verbose response log on first real call and trim once confirmed.
 */
function extractEvereeWorkerId(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;
  if (typeof r.id === 'string' && r.id) return r.id;
  if (typeof r.workerId === 'string' && r.workerId) return r.workerId;
  const data = r.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'string' && d.id) return d.id;
    if (typeof d.workerId === 'string' && d.workerId) return d.workerId;
  }
  return null;
}

/** Create onboarding embed session. Stub. */
export async function createOnboardingSession(input: CreateOnboardingSessionInput): Promise<{
  url: string;
  sessionId: string;
  expiresAt: string;
}> {
  const config = await getEvereeConfigForEntity(input.tenantId, input.entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  await evereeRequest(config, 'POST', '/v2/embed/sessions', {
    workerId: input.evereeWorkerId,
    experienceType: 'ONBOARDING',
    returnUrl: input.returnUrl,
  });
  return {
    url: 'https://stub.everee.com/embed/onboarding',
    sessionId: 'stub-session-id',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

/** Get pay history (list). Stub. */
export async function getPayHistory(
  tenantId: string,
  entityId: string,
  userId: string
): Promise<EvereePayHistoryItem[]> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return [];
  return [];
}

/** Get single pay statement. Stub. */
export async function getPayStatement(
  tenantId: string,
  entityId: string,
  userId: string,
  statementId: string
): Promise<EvereePayStatementSummary | null> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return null;
  return null;
}

/** Admin: push shift to Everee. Stub. */
export async function pushShift(
  tenantId: string,
  entityId: string,
  payload: { evereeWorkerId: string; shiftStart: string; shiftEnd: string; [k: string]: unknown }
): Promise<{ id: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  await evereeRequest(config, 'POST', '/v2/shifts', payload);
  return { id: 'stub-shift-id' };
}

/** Admin: prepare payout. Stub. */
export async function preparePayout(
  tenantId: string,
  entityId: string,
  payload: { payPeriodId?: string; [k: string]: unknown }
): Promise<{ id: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) throw new Error('Everee not configured for this entity');
  await evereeRequest(config, 'POST', '/v2/payouts/prepare', payload);
  return { id: 'stub-payout-id' };
}

/** Ping: validate config and credentials. Stub returns ok when config present. */
export async function ping(tenantId: string, entityId: string): Promise<{ ok: boolean; message?: string }> {
  const config = await getEvereeConfigForEntity(tenantId, entityId);
  if (!config) return { ok: false, message: 'Everee not configured for this entity' };
  await evereeRequest(config, 'GET', '/v2/tenants/me');
  return { ok: true };
}
