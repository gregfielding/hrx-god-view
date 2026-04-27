/**
 * Everee service: worker, onboarding, pay history, shifts, payout (HRX Everee Master Plan §4).
 * Stub implementations; real Everee API calls in later phases.
 */

import { getFirestore } from 'firebase-admin/firestore';
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

/** Create worker in Everee if not already linked; create/update everee_workers doc. Stub. */
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
  const snap = await ref.get();
  const existing = snap.data() as { externalWorkerId?: string } | undefined;
  if (existing?.externalWorkerId) {
    return { evereeWorkerId: existing.externalWorkerId, created: false };
  }
  await evereeRequest(config, 'POST', '/v2/workers', {
    tenantId: config.evereeTenantId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    workerType: input.workerType,
  });
  const evereeWorkerId = 'stub-worker-id';
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return { evereeWorkerId, created: true };
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
