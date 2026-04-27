/**
 * Fan-out rules for server-driven `readinessSnapshotV1` refresh (see syncHrxReadinessSnapshotV1).
 *
 * First pass: for non-assignment sources, recompute all **live** assignments for the worker in the tenant
 * (status in ASSIGNMENT_STATUS_QUERY_LIVE), merged from `userId` and `candidateId` queries, capped at `max`.
 *
 * Rationale: `loadHrxReadinessBuildArgsAdmin` aggregates payroll across worker_payroll_accounts and mixes
 * user-level inputs; recomputing each live assignment is correct and avoids missing cross-entity effects.
 */

import type * as admin from 'firebase-admin';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from '../utils/assignmentStatusNormalize';

const LIVE_STATUSES = [...ASSIGNMENT_STATUS_QUERY_LIVE];

/** `tenants/{tenantId}/assignments/{assignmentId}` only — ignores other `assignments` paths if any. */
export function parseTenantAssignmentFromAssignmentRef(
  ref: admin.firestore.DocumentReference
): { tenantId: string; assignmentId: string } | null {
  const parts = ref.path.split('/');
  if (parts.length === 4 && parts[0] === 'tenants' && parts[2] === 'assignments') {
    return { tenantId: parts[1], assignmentId: parts[3] };
  }
  return null;
}

/**
 * Cross-tenant live assignments for a worker via collection group `assignments`.
 * Each query limited to `maxPerQuery`; merged unique, sorted, then capped at `maxTotal`.
 */
export async function listLiveAssignmentTenantPairsForUserCollectionGroup(
  db: admin.firestore.Firestore,
  uid: string,
  maxTotal = 50,
  maxPerQuery = 50
): Promise<Array<{ tenantId: string; assignmentId: string }>> {
  const userId = String(uid || '').trim();
  if (!userId) return [];

  const cg = db.collectionGroup('assignments');
  const [byUser, byCand] = await Promise.all([
    cg.where('userId', '==', userId).where('status', 'in', LIVE_STATUSES).limit(maxPerQuery).get(),
    cg.where('candidateId', '==', userId).where('status', 'in', LIVE_STATUSES).limit(maxPerQuery).get(),
  ]);

  const seen = new Set<string>();
  const pairs: Array<{ tenantId: string; assignmentId: string }> = [];

  const add = (ref: admin.firestore.DocumentReference) => {
    const p = parseTenantAssignmentFromAssignmentRef(ref);
    if (!p) return;
    const k = `${p.tenantId}/${p.assignmentId}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push(p);
  };

  for (const d of byUser.docs) add(d.ref);
  for (const d of byCand.docs) add(d.ref);

  pairs.sort((a, b) => `${a.tenantId}/${a.assignmentId}`.localeCompare(`${b.tenantId}/${b.assignmentId}`));
  return pairs.slice(0, maxTotal);
}

export function parsePipelineStyleDocIdToUserId(docId: string): string | null {
  const suffixes = ['select', 'workforce', 'events'] as const;
  for (const ek of suffixes) {
    const suf = `__${ek}`;
    if (docId.endsWith(suf)) {
      const uid = docId.slice(0, -suf.length).trim();
      return uid || null;
    }
  }
  return null;
}

export function resolveUserIdFromWorkerOnboardingWrite(
  pipelineId: string,
  after: Record<string, unknown> | null | undefined,
  before: Record<string, unknown> | null | undefined
): string | null {
  const uid = String(after?.userId || before?.userId || '').trim();
  if (uid) return uid;
  return parsePipelineStyleDocIdToUserId(pipelineId);
}

/**
 * Live / upcoming assignment doc ids for a worker within one tenant.
 */
export async function listLiveAssignmentIdsForWorker(
  db: admin.firestore.Firestore,
  tenantId: string,
  userId: string,
  max = 50
): Promise<string[]> {
  const uid = String(userId || '').trim();
  if (!uid) return [];

  const assignRef = db.collection(`tenants/${tenantId}/assignments`);
  const [byUser, byCand] = await Promise.all([
    assignRef.where('userId', '==', uid).where('status', 'in', LIVE_STATUSES).limit(max).get(),
    assignRef.where('candidateId', '==', uid).where('status', 'in', LIVE_STATUSES).limit(max).get(),
  ]);

  const ids = new Set<string>();
  for (const d of byUser.docs) ids.add(d.id);
  for (const d of byCand.docs) ids.add(d.id);
  return [...ids].slice(0, max);
}

export type RecomputeHrxSnapshotFn = (
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string
) => Promise<unknown>;

export async function refreshHrxReadinessSnapshotsForWorkerAssignments(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  userId: string;
  recompute: RecomputeHrxSnapshotFn;
  logLabel: string;
  emit: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}): Promise<void> {
  const { db, tenantId, userId, recompute, logLabel, emit } = args;
  const ids = await listLiveAssignmentIdsForWorker(db, tenantId, userId);
  if (ids.length === 0) return;

  for (const assignmentId of ids) {
    try {
      await recompute(db, tenantId, assignmentId);
    } catch (error) {
      emit.error('hrxReadinessSnapshotV1 fan-out recompute failed', {
        source: logLabel,
        tenantId,
        userId,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
