/**
 * Firestore triggers: refresh `assignments.readinessSnapshotV1` when upstream HRX readiness inputs change.
 * Uses `recomputeHrxReadinessSnapshotForAssignment` from the esbuild bundle (shared with the callable).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import {
  refreshHrxReadinessSnapshotsForWorkerAssignments,
  resolveUserIdFromWorkerOnboardingWrite,
} from './hrxReadinessSnapshotFanout';

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

const triggerOpts = {
  region: 'us-central1' as const,
  maxInstances: 5,
  retry: false,
};

function rowUserId(row: Record<string, unknown> | null | undefined): string {
  return String(row?.userId || row?.candidateId || '').trim();
}

/** Payroll / tax / DD fields on worker_payroll_accounts — any write may change readiness employment inputs. */
export const syncHrxReadinessSnapshotV1OnPayrollWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/worker_payroll_accounts/{payrollDocId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const userId = rowUserId(after) || rowUserId(before);
    if (!userId) return;

    await refreshHrxReadinessSnapshotsForWorkerAssignments({
      db,
      tenantId,
      userId,
      recompute: recomputeHrxReadinessSnapshotForAssignment,
      logLabel: 'worker_payroll_accounts',
      emit: logger,
    });
  }
);

/** External onboarding steps, pipeline fields — feed handbook/policies and entity-scoped employment in loader. */
export const syncHrxReadinessSnapshotV1OnWorkerOnboardingWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/worker_onboarding/{pipelineId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const pipelineId = event.params.pipelineId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const userId = resolveUserIdFromWorkerOnboardingWrite(pipelineId, after, before);
    if (!userId) return;

    await refreshHrxReadinessSnapshotsForWorkerAssignments({
      db,
      tenantId,
      userId,
      recompute: recomputeHrxReadinessSnapshotForAssignment,
      logLabel: 'worker_onboarding',
      emit: logger,
    });
  }
);

/** Entity employment mirror (I-9, E-Verify flags, etc. in some flows). */
export const syncHrxReadinessSnapshotV1OnEntityEmploymentWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/entity_employments/{employmentId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const userId = rowUserId(after) || rowUserId(before);
    if (!userId) return;

    await refreshHrxReadinessSnapshotsForWorkerAssignments({
      db,
      tenantId,
      userId,
      recompute: recomputeHrxReadinessSnapshotForAssignment,
      logLabel: 'entity_employments',
      emit: logger,
    });
  }
);

/** user_employments (e.g. i9Status) — feeds aggregate I-9 completion in loadHrxReadinessBuildArgsAdmin. */
export const syncHrxReadinessSnapshotV1OnUserEmploymentWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/user_employments/{employmentId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const userId = rowUserId(after) || rowUserId(before);
    if (!userId) return;

    await refreshHrxReadinessSnapshotsForWorkerAssignments({
      db,
      tenantId,
      userId,
      recompute: recomputeHrxReadinessSnapshotForAssignment,
      logLabel: 'user_employments',
      emit: logger,
    });
  }
);

/** Certification rows used by buildAssignmentReadiness (filtered per assignment in loader). */
export const syncHrxReadinessSnapshotV1OnComplianceWrite = onDocumentWritten(
  { document: 'tenants/{tenantId}/worker_compliance_items/{itemId}', ...triggerOpts },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const userId = rowUserId(after) || rowUserId(before);
    if (!userId) return;

    await refreshHrxReadinessSnapshotsForWorkerAssignments({
      db,
      tenantId,
      userId,
      recompute: recomputeHrxReadinessSnapshotForAssignment,
      logLabel: 'worker_compliance_items',
      emit: logger,
    });
  }
);
