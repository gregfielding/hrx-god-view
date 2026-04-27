/**
 * When hiring linkage on job orders or accounts changes without updating assignments,
 * refresh `readinessSnapshotV1` for affected **live** assignments (same resolution as
 * `fetchJobOrderBrief` + `resolveAssignmentEntityKey` in hrxReadinessSnapshotLoadContext).
 *
 * Conservative: also recomputes assignments with explicit `entityKey` (usually no-op write);
 * skipping those is a future optimization — not implemented here.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { ASSIGNMENT_STATUS_QUERY_LIVE } from '../utils/assignmentStatusNormalize';

if (!admin.apps.length) admin.initializeApp();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { recomputeHrxReadinessSnapshotForAssignment } = require('./syncHrxReadinessSnapshotV1.cjs') as {
  recomputeHrxReadinessSnapshotForAssignment: (
    db: admin.firestore.Firestore,
    tenantId: string,
    assignmentId: string
  ) => Promise<unknown>;
};

const db = admin.firestore();

const LIVE_STATUSES = [...ASSIGNMENT_STATUS_QUERY_LIVE];

/** Max job-order docs to scan per account (each collection); keeps account handler bounded. */
const MAX_JOB_ORDERS_PER_ACCOUNT_BRANCH = 40;

/** Max assignment recomputes per trigger invocation (deduped). */
const MAX_RECOMPUTES_PER_TRIGGER = 50;

const triggerOpts = {
  region: 'us-central1' as const,
  maxInstances: 5,
  retry: false,
};

function normStr(v: unknown): string {
  return String(v ?? '').trim();
}

function rowOrEmpty(row: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return row && typeof row === 'object' ? row : {};
}

/**
 * `job_orders` / `recruiter_jobOrders`: only `hiringEntityId` and `recruiterAccountId` affect
 * `ReadinessJobOrderHiringBrief` / effective hiring in the snapshot loader.
 */
function jobOrderHiringResolutionGateChanged(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): boolean {
  const b = rowOrEmpty(before);
  const a = rowOrEmpty(after);
  return normStr(b.hiringEntityId) !== normStr(a.hiringEntityId) || normStr(b.recruiterAccountId) !== normStr(a.recruiterAccountId);
}

/** `accounts`: only `hiringEntityId` affects fallback hiring when a job order references this account. */
function accountHiringResolutionGateChanged(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): boolean {
  const b = rowOrEmpty(before);
  const a = rowOrEmpty(after);
  return normStr(b.hiringEntityId) !== normStr(a.hiringEntityId);
}

async function recomputeLiveAssignmentsForJobOrder(args: {
  tenantId: string;
  jobOrderId: string;
  logSource: string;
}): Promise<void> {
  const { tenantId, jobOrderId, logSource } = args;
  const jo = String(jobOrderId || '').trim();
  if (!jo) return;

  const snap = await db
    .collection(`tenants/${tenantId}/assignments`)
    .where('jobOrderId', '==', jo)
    .where('status', 'in', LIVE_STATUSES)
    .limit(MAX_RECOMPUTES_PER_TRIGGER)
    .get();

  if (snap.empty) return;

  logger.info('hrxReadinessSnapshotV1 hiring linkage fan-out', {
    source: logSource,
    tenantId,
    jobOrderId: jo,
    assignmentCount: snap.docs.length,
  });

  for (const d of snap.docs) {
    try {
      await recomputeHrxReadinessSnapshotForAssignment(db, tenantId, d.id);
    } catch (error) {
      logger.error('failed to sync readinessSnapshotV1 (hiring linkage)', {
        source: logSource,
        tenantId,
        jobOrderId: jo,
        assignmentId: d.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function recomputeLiveAssignmentsForAccount(args: { tenantId: string; accountId: string }): Promise<void> {
  const { tenantId, accountId } = args;
  const acc = String(accountId || '').trim();
  if (!acc) return;

  const [joSnap, rjoSnap] = await Promise.all([
    db
      .collection(`tenants/${tenantId}/job_orders`)
      .where('recruiterAccountId', '==', acc)
      .limit(MAX_JOB_ORDERS_PER_ACCOUNT_BRANCH)
      .get(),
    db
      .collection(`tenants/${tenantId}/recruiter_jobOrders`)
      .where('recruiterAccountId', '==', acc)
      .limit(MAX_JOB_ORDERS_PER_ACCOUNT_BRANCH)
      .get(),
  ]);

  const jobOrderIds = new Set<string>();
  joSnap.docs.forEach((d) => jobOrderIds.add(d.id));
  rjoSnap.docs.forEach((d) => jobOrderIds.add(d.id));

  if (jobOrderIds.size === 0) return;

  const assignmentIds = new Set<string>();
  for (const joId of [...jobOrderIds].sort()) {
    if (assignmentIds.size >= MAX_RECOMPUTES_PER_TRIGGER) break;
    const snap = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('jobOrderId', '==', joId)
      .where('status', 'in', LIVE_STATUSES)
      .limit(MAX_RECOMPUTES_PER_TRIGGER)
      .get();
    for (const d of snap.docs) {
      assignmentIds.add(d.id);
      if (assignmentIds.size >= MAX_RECOMPUTES_PER_TRIGGER) break;
    }
  }

  const sortedIds = [...assignmentIds].sort();
  if (sortedIds.length === 0) return;

  logger.info('hrxReadinessSnapshotV1 hiring linkage fan-out (account)', {
    tenantId,
    accountId: acc,
    jobOrderCount: jobOrderIds.size,
    assignmentCount: sortedIds.length,
  });

  for (const assignmentId of sortedIds) {
    try {
      await recomputeHrxReadinessSnapshotForAssignment(db, tenantId, assignmentId);
    } catch (error) {
      logger.error('failed to sync readinessSnapshotV1 (hiring linkage account)', {
        tenantId,
        accountId: acc,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const syncHrxReadinessSnapshotV1OnJobOrderWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/job_orders/{jobOrderId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    if (!jobOrderHiringResolutionGateChanged(before, after)) return;
    await recomputeLiveAssignmentsForJobOrder({ tenantId, jobOrderId, logSource: 'job_orders' });
  }
);

export const syncHrxReadinessSnapshotV1OnRecruiterJobOrderWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/recruiter_jobOrders/{jobOrderId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const jobOrderId = event.params.jobOrderId as string;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    if (!jobOrderHiringResolutionGateChanged(before, after)) return;
    await recomputeLiveAssignmentsForJobOrder({ tenantId, jobOrderId, logSource: 'recruiter_jobOrders' });
  }
);

export const syncHrxReadinessSnapshotV1OnAccountHiringWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/accounts/{accountId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const accountId = event.params.accountId as string;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    if (!accountHiringResolutionGateChanged(before, after)) return;
    await recomputeLiveAssignmentsForAccount({ tenantId, accountId });
  }
);
