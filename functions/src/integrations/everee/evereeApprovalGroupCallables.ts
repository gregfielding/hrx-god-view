/**
 * Everee approval-group callables (Phase B of HRX Everee Master Plan §5).
 *
 * Three admin-only surfaces:
 *
 * 1. `evereeListApprovalGroups({ tenantId, entityId })`
 *      → list groups available in the entity's Everee tenant. Powers the
 *        admin-UI dropdown on the entity-settings panel.
 *
 * 2. `evereeAssignApprovalGroup({ tenantId, entityId, userId, approvalGroupId | null })`
 *      → re-route an existing worker to a different group (or clear by
 *        passing `null`). Also writes the assignment to the linkage doc
 *        (`tenants/{tid}/everee_workers/{eid}__{uid}.approvalGroupId`) so
 *        we have an audit trail and the next backfill is a no-op.
 *
 * 3. `evereeReassignAllWorkersToGroup({ tenantId, entityId, approvalGroupId | null, dryRun? })`
 *      → bulk version of (2) for an entity migration. Defaults to dryRun
 *        so the admin can see the impact before flipping the switch.
 *
 * All three are gated by `canManageEveree` — same gate as the existing
 * admin/recruiter Everee surfaces. Uses the Phase A helper module
 * (`./evereeApprovalGroups.ts`) for the actual Everee REST calls so
 * scratch scripts and callables stay in lockstep.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { canManageEveree } from './evereeAccessGate';
import { requireEvereeEnabledEntity } from './evereeConfig';
import {
  listEvereeApprovalGroups,
  setEvereeWorkerApprovalGroup,
} from './evereeApprovalGroups';

if (!admin.apps.length) {
  admin.initializeApp();
}

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be authenticated');
  }
  return request.auth;
}

function requireTenantEntity(data: unknown): { tenantId: string; entityId: string } {
  const d = data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  if (!tenantId || !entityId) {
    throw new HttpsError('invalid-argument', 'tenantId and entityId required');
  }
  return { tenantId, entityId };
}

/**
 * Coerce a callable-supplied approvalGroupId into the canonical wire shape:
 *   - `string` (trimmed, non-empty)  → keep
 *   - `number` (finite)              → String(n)  (legacy clients)
 *   - explicit `null`                → `null`     (clears the assignment)
 *   - missing / empty / other        → throws invalid-argument
 *
 * We treat `undefined` differently from `null` on purpose: `undefined` is
 * "you forgot the field" (error), `null` is "explicitly clear" (intent).
 */
function coerceApprovalGroupArg(value: unknown, allowNull: boolean): string | null {
  if (value === null) {
    if (!allowNull) {
      throw new HttpsError('invalid-argument', 'approvalGroupId may not be null on this call');
    }
    return null;
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t) return t;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  throw new HttpsError('invalid-argument', 'approvalGroupId must be a non-empty string');
}

/**
 * `evereeListApprovalGroups` — admin-only group catalog for the entity's
 * Everee tenant. Used by the entity-settings UI to populate a dropdown.
 *
 * Returns `{ ok, evereeTenantId, groups }` on success. On Everee API
 * failure throws `failed-precondition` with the upstream message (truncated
 * to 480 chars) so the toast can surface it.
 */
export const evereeListApprovalGroups = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed to manage Everee for this tenant');
  }
  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  try {
    const groups = await listEvereeApprovalGroups(config);
    return {
      ok: true as const,
      evereeTenantId: config.evereeTenantId,
      groups,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeListApprovalGroups] failed', { tenantId, entityId, message: msg });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Could not list Everee approval groups';
    throw new HttpsError('failed-precondition', safe);
  }
});

interface AssignResult {
  ok: true;
  userId: string;
  externalWorkerId: string;
  approvalGroupId: string | null;
  /** previousApprovalGroupId in the linkage doc (NOT what Everee had — UX hint only). */
  previousApprovalGroupId: string | null;
}

/**
 * Single-worker re-assign. Looks up the linkage doc to find the
 * `externalWorkerId`, calls Everee's PUT, and mirrors the new value back
 * onto the doc. Refuses to act when the linkage doc:
 *   - doesn't exist (worker was never provisioned in Everee)
 *   - has no externalWorkerId (provisioning crashed mid-flight)
 *   - points at a different evereeTenantId than the entity (drift — needs
 *     repair via the existing repair script before re-assign makes sense)
 */
export const evereeAssignApprovalGroup = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed to manage Everee for this tenant');
  }
  const d = request.data as Record<string, unknown> | null;
  const userId = typeof d?.userId === 'string' ? d.userId : '';
  if (!userId) {
    throw new HttpsError('invalid-argument', 'userId required');
  }
  const newGroup = coerceApprovalGroupArg(d?.approvalGroupId, /* allowNull */ true);

  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  const linkRef = admin
    .firestore()
    .doc(`tenants/${tenantId}/everee_workers/${entityId}__${userId}`);
  const snap = await linkRef.get();
  if (!snap.exists) {
    throw new HttpsError(
      'failed-precondition',
      'Worker has no Everee linkage doc — provision them first',
    );
  }
  const link = snap.data() as Record<string, unknown>;
  const externalWorkerId = String(link.externalWorkerId || '').trim();
  if (!externalWorkerId) {
    throw new HttpsError(
      'failed-precondition',
      'Linkage doc has no externalWorkerId — re-run provisioning',
    );
  }
  const linkTenantId = String(link.evereeTenantId || '').trim();
  if (linkTenantId && linkTenantId !== config.evereeTenantId) {
    throw new HttpsError(
      'failed-precondition',
      `Linkage doc points at evereeTenantId=${linkTenantId} but entity is now ${config.evereeTenantId}; repair drift before re-assigning`,
    );
  }

  try {
    await setEvereeWorkerApprovalGroup(config, externalWorkerId, newGroup);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('[evereeAssignApprovalGroup] api_call_failed', {
      tenantId,
      entityId,
      userId,
      externalWorkerId,
      newGroup,
      message: msg,
    });
    const safe =
      msg.length > 480 ? `${msg.slice(0, 480)}…` : msg || 'Everee rejected the assignment';
    throw new HttpsError('failed-precondition', safe);
  }

  const previousApprovalGroupId =
    typeof link.approvalGroupId === 'string' ? (link.approvalGroupId as string) : null;
  await linkRef.set(
    {
      // `null` clears the field via FieldValue.delete; otherwise overwrite.
      approvalGroupId:
        newGroup === null ? admin.firestore.FieldValue.delete() : newGroup,
      approvalGroupAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
      approvalGroupAssignedByUid: request.auth?.uid ?? null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  const result: AssignResult = {
    ok: true,
    userId,
    externalWorkerId,
    approvalGroupId: newGroup,
    previousApprovalGroupId,
  };
  return result;
});

interface BulkResult {
  ok: true;
  dryRun: boolean;
  evereeTenantId: string;
  approvalGroupId: string | null;
  candidates: number;
  succeeded: number;
  failed: number;
  failures: Array<{
    userId: string | null;
    externalWorkerId: string;
    error: string;
  }>;
}

/**
 * Bulk re-assign every linkage doc under an entity to `approvalGroupId`
 * (or clear it with `null`). Skips workers already on the target group so
 * re-runs are a no-op.
 *
 * Defaults to `dryRun: true` — caller MUST pass `dryRun: false` to actually
 * mutate Everee. Hard-capped at 1000 candidates per invocation; larger
 * entities should use the scratch backfill script (which paginates).
 *
 * Concurrency is set to 4 in-flight PUTs — same as the scratch script's
 * default, polite to Everee, and well under any rate limits we've hit.
 */
const BULK_REASSIGN_HARD_CAP = 1000;
const BULK_REASSIGN_CONCURRENCY = 4;

export const evereeReassignAllWorkersToGroup = onCall(async (request) => {
  requireAuth(request);
  const { tenantId, entityId } = requireTenantEntity(request.data);
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError('permission-denied', 'Not allowed to manage Everee for this tenant');
  }
  const d = request.data as Record<string, unknown> | null;
  const newGroup = coerceApprovalGroupArg(d?.approvalGroupId, /* allowNull */ true);
  // Default to dry-run for safety. Callers must opt in to writes.
  const dryRun = d?.dryRun === false ? false : true;

  const config = await requireEvereeEnabledEntity(tenantId, entityId);
  // Filter on entityId AND current evereeTenantId so we never accidentally
  // PUT against drifted linkage docs (those need the repair workflow).
  const snap = await admin
    .firestore()
    .collection('tenants')
    .doc(tenantId)
    .collection('everee_workers')
    .where('entityId', '==', entityId)
    .where('evereeTenantId', '==', config.evereeTenantId)
    .limit(BULK_REASSIGN_HARD_CAP + 1)
    .get();

  if (snap.docs.length > BULK_REASSIGN_HARD_CAP) {
    throw new HttpsError(
      'resource-exhausted',
      `Entity has more than ${BULK_REASSIGN_HARD_CAP} workers; use the scratch backfill script for large migrations`,
    );
  }

  const candidates: Array<{
    docRef: FirebaseFirestore.DocumentReference;
    externalWorkerId: string;
    userId: string | null;
    currentGroup: string | null;
  }> = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const externalWorkerId = String(data.externalWorkerId || '').trim();
    if (!externalWorkerId) continue;
    const currentGroup =
      typeof data.approvalGroupId === 'string' ? (data.approvalGroupId as string) : null;
    if (currentGroup === newGroup) continue;
    candidates.push({
      docRef: doc.ref,
      externalWorkerId,
      userId: typeof data.userId === 'string' ? data.userId : null,
      currentGroup,
    });
  }

  if (dryRun || candidates.length === 0) {
    const result: BulkResult = {
      ok: true,
      dryRun: true,
      evereeTenantId: config.evereeTenantId,
      approvalGroupId: newGroup,
      candidates: candidates.length,
      succeeded: 0,
      failed: 0,
      failures: [],
    };
    return result;
  }

  // Tiny in-process worker pool — Promise.all with a sliding window. Avoids
  // the overhead of an extra dep (p-limit) and keeps semantics obvious.
  let succeeded = 0;
  let failed = 0;
  const failures: BulkResult['failures'] = [];
  let nextIndex = 0;

  async function runOne() {
    while (true) {
      const i = nextIndex++;
      if (i >= candidates.length) return;
      const c = candidates[i];
      try {
        await setEvereeWorkerApprovalGroup(config, c.externalWorkerId, newGroup);
        await c.docRef.set(
          {
            approvalGroupId:
              newGroup === null ? admin.firestore.FieldValue.delete() : newGroup,
            approvalGroupAssignedAt: admin.firestore.FieldValue.serverTimestamp(),
            approvalGroupAssignedByUid: request.auth?.uid ?? null,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
        succeeded += 1;
      } catch (e: unknown) {
        failed += 1;
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({
          userId: c.userId,
          externalWorkerId: c.externalWorkerId,
          error: msg.length > 240 ? `${msg.slice(0, 240)}…` : msg,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(BULK_REASSIGN_CONCURRENCY, candidates.length) }, runOne),
  );

  const result: BulkResult = {
    ok: true,
    dryRun: false,
    evereeTenantId: config.evereeTenantId,
    approvalGroupId: newGroup,
    candidates: candidates.length,
    succeeded,
    failed,
    failures: failures.slice(0, 25),
  };
  return result;
});
