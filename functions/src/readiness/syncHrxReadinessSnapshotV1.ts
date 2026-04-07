/**
 * Callable: recompute HRX V1 readiness from authoritative Firestore sources and persist `readinessSnapshotV1`
 * on `tenants/{tenantId}/assignments/{assignmentId}`.
 *
 * Also exports `recomputeHrxReadinessSnapshotForAssignment` for Firestore triggers (same bundle).
 *
 * Built with esbuild (see `package.json`); excluded from plain `tsc` because this graph imports `shared/` + `src/`.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { buildAssignmentReadiness } from '../../../src/shared/buildAssignmentReadiness';
import {
  READINESS_SNAPSHOT_V1_SOURCE_VERSION,
  buildReadinessSnapshotV1Comparable,
  readinessSnapshotV1ComparableJson,
  type ReadinessSnapshotV1Comparable,
} from '../../../src/shared/readinessSnapshotV1';
import { loadHrxReadinessBuildArgsAdmin } from './hrxReadinessSnapshotLoadContext';

function tryParseComparable(raw: unknown): ReadinessSnapshotV1Comparable | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.state !== 'string' || typeof o.sourceVersion !== 'number') return null;
  const summary = o.summary;
  if (!summary || typeof summary !== 'object') return null;
  const s = summary as Record<string, unknown>;
  if (
    typeof s.blockers !== 'number' ||
    typeof s.warnings !== 'number' ||
    typeof s.completed !== 'number'
  ) {
    return null;
  }
  if (!Array.isArray(o.requirements)) return null;
  return {
    state: o.state as ReadinessSnapshotV1Comparable['state'],
    sourceVersion: o.sourceVersion as number,
    summary: {
      blockers: s.blockers as number,
      warnings: s.warnings as number,
      completed: s.completed as number,
    },
    requirements: o.requirements as ReadinessSnapshotV1Comparable['requirements'],
  };
}

export type RecomputeHrxReadinessSnapshotResult = {
  skipped: boolean;
  missingAssignment: boolean;
  snapshot: ReadinessSnapshotV1Comparable;
};

/**
 * Idempotent recompute for triggers and callable. No auth — callers must enforce scope.
 */
export async function recomputeHrxReadinessSnapshotForAssignment(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string
): Promise<RecomputeHrxReadinessSnapshotResult> {
  const args = await loadHrxReadinessBuildArgsAdmin(db, { tenantId, assignmentId });
  if (!args) {
    return {
      skipped: true,
      missingAssignment: true,
      snapshot: {
        state: 'PENDING_INITIALIZATION',
        sourceVersion: READINESS_SNAPSHOT_V1_SOURCE_VERSION,
        summary: { blockers: 0, warnings: 0, completed: 0 },
        requirements: [],
      },
    };
  }

  const result = buildAssignmentReadiness(args);
  const nextComparable = buildReadinessSnapshotV1Comparable(result);
  const assignRef = db.doc(`tenants/${tenantId}/assignments/${assignmentId}`);
  const cur = await assignRef.get();
  const existingRaw = cur.get('readinessSnapshotV1');
  const existingComparable = tryParseComparable(existingRaw);
  if (
    existingComparable &&
    readinessSnapshotV1ComparableJson(existingComparable) === readinessSnapshotV1ComparableJson(nextComparable)
  ) {
    logger.info('readinessSnapshotV1 unchanged; skip write', { tenantId, assignmentId });
    return { skipped: true, missingAssignment: false, snapshot: nextComparable };
  }

  await assignRef.set(
    {
      readinessSnapshotV1: {
        ...nextComparable,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    { merge: true }
  );

  logger.info('readinessSnapshotV1 written', { tenantId, assignmentId, state: nextComparable.state });
  return { skipped: false, missingAssignment: false, snapshot: nextComparable };
}

async function assertCanManageAssignmentsForTenant(
  auth: { token?: Record<string, unknown>; uid: string },
  tenantId: string,
  uid: string
): Promise<void> {
  const roles = (auth?.token?.roles || {}) as Record<string, { role?: string }>;
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ['Recruiter', 'Manager', 'Admin'].includes(String(tenantRole))) return;
  if (auth?.token?.isHRX === true) return;

  const db = admin.firestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'No permission to sync readiness for this tenant.');
  }
  const userData: Record<string, unknown> = userSnap.data() || {};
  const tenantMeta = (userData.tenantIds as Record<string, Record<string, unknown>> | undefined)?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || '').trim().toLowerCase();
  if (['recruiter', 'manager', 'admin'].includes(role)) return;
  const recruiterEnabled = Boolean(tenantMeta.recruiter ?? userData.recruiter);
  if (recruiterEnabled) return;
  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? '0';
  const sec = parseInt(String(secRaw), 10);
  if (!Number.isNaN(sec) && sec >= 4) return;

  throw new HttpsError('permission-denied', 'No permission to sync readiness for this tenant.');
}

export const syncHrxReadinessSnapshotV1 = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const tenantId = String(request.data?.tenantId || '').trim();
  const assignmentId = String(request.data?.assignmentId || '').trim();
  if (!tenantId || !assignmentId) {
    throw new HttpsError('invalid-argument', 'tenantId and assignmentId are required.');
  }

  await assertCanManageAssignmentsForTenant(request.auth, tenantId, request.auth.uid);

  const db = admin.firestore();
  const { skipped, missingAssignment, snapshot } = await recomputeHrxReadinessSnapshotForAssignment(
    db,
    tenantId,
    assignmentId
  );
  if (missingAssignment) {
    throw new HttpsError('not-found', 'Assignment not found or missing worker user id.');
  }

  return { skipped, snapshot };
});
