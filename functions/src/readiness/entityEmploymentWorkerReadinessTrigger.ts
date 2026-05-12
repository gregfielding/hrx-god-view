import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { C1_TENANT_ID } from './c1WorkerScope';
import { persistWorkerReadinessV1ForUidIfChanged } from './workerReadinessV1Persist';

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/**
 * Worker-readiness fields that actually flow into
 * `deriveOverallWorkerState` from each `entity_employments` row. Sourced
 * from `coerceEmploymentSignal` in `workerReadinessV1Persist.ts`.
 *
 * Anything NOT in this list (reminder timestamps, payroll bookkeeping,
 * `updatedAt`, etc.) cannot affect the snapshot, so the full recompute
 * is wasted work. Bulk maintenance scripts that touch these "boring"
 * fields used to OOM-loop this trigger — see the `fast-path` comment in
 * the function body for the May 2026 incident that prompted the guard.
 */
const READINESS_RELEVANT_EMPLOYMENT_FIELDS = ['status', 'employmentState'] as const;

/**
 * When C1 `entity_employments` changes, refresh `users.{uid}.workerReadinessV1` (overall state + profile snapshot).
 */
export const syncWorkerReadinessV1FromEntityEmployment = onDocumentWritten(
  {
    document: 'tenants/{tenantId}/entity_employments/{employmentId}',
    region: 'us-central1',
    // Inherits global default 512 MiB but the deployed instance is
    // pinned to 256 MiB (pre-dates the global bump). Explicitly set
    // here so a redeploy actually moves it. Profiling shows
    // `loadC1WorkerReadinessContext` peaks ~340-450 MiB for workers
    // with 100+ assignments + 5+ employments, which is exactly the
    // population that hit OOM on May 12 2026 during the C1 Events
    // payroll-link backfill (4,163 rows in 8 min).
    memory: '1GiB',
    maxInstances: 10,
    retry: false,
  },
  async (event) => {
    const tenantId = event.params.tenantId as string;
    if (tenantId !== C1_TENANT_ID) return;

    const after = event.data?.after?.exists ? (event.data.after.data() as Record<string, unknown>) : null;
    const before = event.data?.before?.exists ? (event.data.before.data() as Record<string, unknown>) : null;
    const row = after || before;
    if (!row) return;

    const uid = String(row.userId || row.candidateId || '').trim();
    if (!uid) return;

    // Fast-path: skip the recompute when no readiness-relevant field
    // changed. The recompute is expensive (`loadC1WorkerReadinessContext`
    // runs 4 parallel queries + a profile readiness rebuild + a user-doc
    // write) and produces an unchanged snapshot in this case anyway.
    //
    // Bulk reminder backfills are the worst offenders — the May 2026 C1
    // Events R4/R5 backfill wrote 4,163 entity_employments rows in 8
    // minutes, each touching only `onboardingReminder4DueAt`,
    // `onboardingReminder5DueAt`, and `updatedAt`. Pre-fix, every one of
    // those fired this trigger, hit Firestore for the full readiness
    // context, OOM'd at 256 MiB on workers with large assignment
    // histories, and starved the `maxInstances=3` worker pool — taking
    // overall app latency with it. Skipping when only bookkeeping fields
    // changed avoids the entire problem on the next backfill.
    //
    // Both before/after must exist for a true field-change comparison;
    // creates and deletes always recompute.
    if (after && before) {
      const noRelevantChange = READINESS_RELEVANT_EMPLOYMENT_FIELDS.every(
        (field) => String(before[field] ?? '') === String(after[field] ?? ''),
      );
      if (noRelevantChange) return;
    }

    try {
      const { wrote } = await persistWorkerReadinessV1ForUidIfChanged(db, uid);
      if (wrote) {
        logger.info('synced workerReadinessV1 (entity_employments)', { uid, employmentId: event.params.employmentId });
      }
    } catch (error) {
      logger.error('failed to sync workerReadinessV1 from entity_employments', {
        uid,
        employmentId: event.params.employmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
);
