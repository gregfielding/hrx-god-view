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
import { getEvereeConfigForEntity } from './evereeConfig';
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
}

export interface CreateOnboardingSessionInput {
  tenantId: string;
  entityId: string;
  userId: string;
  evereeWorkerId: string;
  returnUrl?: string;
}

/**
 * Create worker in Everee if not already linked; create/update everee_workers doc.
 *
 * Idempotent: if `everee_workers/{entityId}__{userId}` already carries an
 * `externalWorkerId`, the function returns immediately (no outbound POST). The
 * "Sync to Everee" button in the recruiter UI relies on this to safely re-emit
 * clicks without spawning duplicate Everee workers.
 *
 * On success, also mirrors `evereeWorkerId` onto the worker's
 * `entity_employments` doc for this entity so the UI / readiness layers can
 * surface the linkage without joining through `everee_workers`.
 */
export async function createWorkerIfNeeded(input: CreateWorkerInput): Promise<{
  evereeWorkerId: string;
  created: boolean;
}> {
  const config = await getEvereeConfigForEntity(input.tenantId, input.entityId);
  if (!config) {
    throw new Error('Everee not configured for this entity');
  }
  const db = getFirestore();
  const ref = db.doc(evereePaths.worker(input.tenantId, input.entityId, input.userId));
  const logCtx = {
    surface: 'everee.createWorker' as const,
    tenantId: input.tenantId,
    entityId: input.entityId,
    userId: input.userId,
    evereeTenantId: config.evereeTenantId,
  };

  const snap = await ref.get();
  const existing = snap.data() as { externalWorkerId?: string } | undefined;
  if (existing?.externalWorkerId) {
    logger.info('everee.createWorker — idempotent hit, returning existing worker id', {
      ...logCtx,
      evereeWorkerId: existing.externalWorkerId,
    });
    return { evereeWorkerId: existing.externalWorkerId, created: false };
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

  logger.info('everee.createWorker — request', {
    ...logCtx,
    method: 'POST',
    url: fullUrl,
    headers: {
      authorization: 'Basic <redacted>',
      'x-everee-tenant-id': config.evereeTenantId,
      'content-type': 'application/json',
    },
    body: requestBody,
  });

  const startedAt = Date.now();
  let response: unknown;
  try {
    response = await evereeRequest<unknown>(config, 'POST', '/v2/workers', requestBody);
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    logger.error('everee.createWorker — request failed', {
      ...logCtx,
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
  const durationMs = Date.now() - startedAt;
  logger.info('everee.createWorker — response', {
    ...logCtx,
    durationMs,
    status: 'ok',
    response,
  });

  const evereeWorkerId = extractEvereeWorkerId(response);
  if (!evereeWorkerId) {
    const responseKeys =
      response && typeof response === 'object'
        ? Object.keys(response as Record<string, unknown>).join(',')
        : typeof response;
    logger.error('everee.createWorker — could not extract worker id from response', {
      ...logCtx,
      responseKeys,
      response,
    });
    throw new Error(
      `Everee did not return a recognizable worker id. Response keys: ${responseKeys}`,
    );
  }

  const nowIso = new Date().toISOString();
  await ref.set(
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

  // Mirror the linkage onto the worker's `entity_employments` doc for this entity.
  // Doc id is the `worker_onboarding` pipelineId — opaque, so we resolve it via
  // (userId, entityId). Best-effort: a missing employment doc must not fail the sync.
  try {
    const eeSnap = await db
      .collection(`tenants/${input.tenantId}/entity_employments`)
      .where('userId', '==', input.userId)
      .where('entityId', '==', input.entityId)
      .limit(1)
      .get();
    if (!eeSnap.empty) {
      await eeSnap.docs[0].ref.set(
        { evereeWorkerId, evereeWorkerLinkedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      logger.info('everee.createWorker — linked to entity_employments', {
        ...logCtx,
        entityEmploymentId: eeSnap.docs[0].id,
        evereeWorkerId,
      });
    } else {
      logger.warn('everee.createWorker — no entity_employments doc to link', {
        ...logCtx,
      });
    }
  } catch (err) {
    logger.error('everee.createWorker — entity_employments mirror failed', {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { evereeWorkerId, created: true };
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
