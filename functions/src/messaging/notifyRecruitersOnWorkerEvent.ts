/**
 * Recruiter Notification Helper — worker-side events.
 *
 * Phase 2B of the Shift Cadence Engine.
 *
 * A thin wrapper over the existing `dashboardFeed` pattern so the cadence
 * code (and anyone else) can emit a recruiter-facing alert for a
 * worker-originated event without re-deriving the recruiter list or the
 * notification doc shape each time.
 *
 * Routing:
 *   assignment.jobOrderId
 *     → tenants/{tid}/job_orders/{joid}  (assignedRecruiters[] / recruiterId)
 *       → for each recruiter: dashboardFeed/{id}
 *
 * This file deliberately does NOT send SMS to recruiters. Recruiters
 * currently live on the web dashboard; the SMS-to-recruiter channel is a
 * separate workstream. The dashboardFeed entry opens into the same drawer
 * the existing job-order / application / task alerts use, so recruiters get
 * one unified feed.
 *
 * Idempotency:
 *   Caller provides a stable `dedupeKey`. We hash it into the doc id so
 *   repeated sends of the same event don't spam the recruiter feed —
 *   e.g. the T+30 no-show check is dispatched once but `dispatchOneReminder`
 *   runs under claim-lock + retry, so even with backoff we only ever write
 *   one notification per (assignment, event).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export type RecruiterWorkerEventKind =
  | 'cadence_worker_cancelled'
  | 'cadence_walk_off_warning'
  | 'cadence_no_show'
  // Kept open-ended — callers can pass any string to categorize. We record
  // it verbatim in the notification `extra.kind` for downstream filters.
  | (string & { readonly _brand?: unique symbol });

export interface NotifyRecruitersArgs {
  tenantId: string;
  assignmentId: string;
  /** Assignment doc data. We pull jobOrderId and fall back fields from it. */
  assignment: Record<string, unknown>;
  event: {
    kind: RecruiterWorkerEventKind;
    /** Short title shown as the first line of the recruiter feed entry. */
    title: string;
    /** Longer description shown underneath the title. */
    snippet: string;
    /** Stable per-event dedupe key. Same key = same doc id = no dupes. */
    dedupeKey: string;
    /** Optional free-form metadata merged into `extra`. */
    extra?: Record<string, unknown>;
  };
  /**
   * Override the dashboard drawer route. Defaults to the assignment detail
   * route under the recruiter UI, which is the most useful landing for
   * worker events.
   */
  route?: string;
}

export interface NotifyRecruitersResult {
  notifiedRecruiterIds: string[];
  skipped: Array<{ reason: string; recruiterId?: string }>;
}

function uniqStrings(values: unknown): string[] {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  );
}

function resolveRecruiterIdsFromJobOrder(jobOrder: Record<string, unknown> | null): string[] {
  if (!jobOrder) return [];
  const modern = uniqStrings(jobOrder.assignedRecruiters);
  if (modern.length > 0) return modern;
  const legacy =
    typeof jobOrder.recruiterId === 'string' && jobOrder.recruiterId.trim()
      ? [jobOrder.recruiterId.trim()]
      : [];
  return legacy;
}

function sanitizeDocId(s: string): string {
  // Firestore doc ids can't contain `/`, and we want something that's also
  // safe to pass through URL params. Keep it simple + bounded.
  return s.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 180);
}

async function loadJobOrder(
  tenantId: string,
  jobOrderId: string,
): Promise<Record<string, unknown> | null> {
  if (!tenantId || !jobOrderId) return null;
  try {
    const snap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (!snap.exists) return null;
    return snap.data() as Record<string, unknown>;
  } catch (err) {
    logger.warn('[notifyRecruiters] load_job_order_failed', {
      tenantId,
      jobOrderId,
      err: (err as Error)?.message || String(err),
    });
    return null;
  }
}

/**
 * Write one dashboardFeed entry per recruiter. Failures on individual writes
 * are logged but not thrown — we never want a recruiter-alert glitch to
 * abort the worker-side flow that triggered it.
 */
export async function notifyRecruitersOnWorkerEvent(
  args: NotifyRecruitersArgs,
): Promise<NotifyRecruitersResult> {
  const { tenantId, assignmentId, assignment, event } = args;
  const skipped: NotifyRecruitersResult['skipped'] = [];
  const notifiedRecruiterIds: string[] = [];

  const jobOrderId = typeof assignment.jobOrderId === 'string' ? assignment.jobOrderId.trim() : '';
  if (!jobOrderId) {
    skipped.push({ reason: 'assignment_missing_jobOrderId' });
    logger.warn('[notifyRecruiters] skip_no_jobOrderId', { tenantId, assignmentId });
    return { notifiedRecruiterIds, skipped };
  }

  const jobOrder = await loadJobOrder(tenantId, jobOrderId);
  if (!jobOrder) {
    skipped.push({ reason: 'job_order_not_found' });
    logger.warn('[notifyRecruiters] skip_no_jobOrder', { tenantId, assignmentId, jobOrderId });
    return { notifiedRecruiterIds, skipped };
  }

  const recruiterIds = resolveRecruiterIdsFromJobOrder(jobOrder);
  if (recruiterIds.length === 0) {
    skipped.push({ reason: 'no_recruiters_assigned' });
    logger.warn('[notifyRecruiters] skip_no_recruiters', { tenantId, assignmentId, jobOrderId });
    return { notifiedRecruiterIds, skipped };
  }

  const route = args.route || `/recruiter/assignments/${assignmentId}`;
  const now = admin.firestore.Timestamp.now();

  for (const recruiterId of recruiterIds) {
    const docId = sanitizeDocId(`${event.dedupeKey}__${recruiterId}`);
    try {
      await db.collection('dashboardFeed').doc(docId).set(
        {
          id: docId,
          userId: recruiterId,
          tenantId,
          sourceType: 'notification' as const,
          sourceId: assignmentId,
          title: event.title,
          snippet: event.snippet,
          fromLabel: 'HRX',
          avatarUrl: null,
          isUnread: true,
          isMuted: false,
          timestamp: now.toMillis(),
          drawerScope: {
            scopeType: 'notification' as const,
            route,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          extra: {
            kind: event.kind,
            assignmentId,
            jobOrderId,
            ...(event.extra || {}),
          },
        },
        { merge: true },
      );
      notifiedRecruiterIds.push(recruiterId);
    } catch (err) {
      skipped.push({ reason: 'write_failed', recruiterId });
      logger.error('[notifyRecruiters] write_failed', {
        tenantId,
        assignmentId,
        recruiterId,
        err: (err as Error)?.message || String(err),
      });
    }
  }

  logger.info('[notifyRecruiters] done', {
    tenantId,
    assignmentId,
    jobOrderId,
    kind: event.kind,
    notifiedCount: notifiedRecruiterIds.length,
    skippedCount: skipped.length,
  });

  return { notifiedRecruiterIds, skipped };
}
