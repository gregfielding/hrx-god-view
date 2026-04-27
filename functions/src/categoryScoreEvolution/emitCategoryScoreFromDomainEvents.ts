/**
 * Domain-event hooks → category score evolution (calls applyCategoryScoreEventInternal).
 * Keep side effects best-effort: log and continue; never throw from triggers.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { HttpsError } from 'firebase-functions/v2/https';
import { applyCategoryScoreEventInternal } from './applyCategoryScoreEventCore';

/** Aligns with readiness screening “satisfied” style checks (Accusource + flags). */
export function isBackgroundCheckRecordCompleted(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const h = String(data.hrxStatus || '').toLowerCase();
  if (h === 'completed' || h === 'report_ready') return true;
  if (data.finalReportReady === true) return true;
  if (data.orderCompleted === true) return true;
  return false;
}

export function backgroundCheckJustCompleted(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!after) return false;
  return isBackgroundCheckRecordCompleted(after) && !isBackgroundCheckRecordCompleted(before);
}

export function rawAssignmentCompleted(status: string | null | undefined): boolean {
  const x = String(status || '').trim().toLowerCase();
  return x === 'completed' || x === 'ended';
}

/** Stored as `no-show` in some worker UIs; accept a few aliases. */
export function rawAssignmentNoShow(status: string | null | undefined): boolean {
  const x = String(status || '').trim().toLowerCase().replace(/-/g, '_');
  return x === 'no_show' || x === 'noshow';
}

export function assignmentJustCompleted(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!after) return false;
  const a = String(after.status ?? '');
  const b = before ? String(before.status ?? '') : '';
  return rawAssignmentCompleted(a) && !rawAssignmentCompleted(b);
}

export function assignmentJustMarkedNoShow(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): boolean {
  if (!after) return false;
  const a = String(after.status ?? '');
  const b = before ? String(before.status ?? '') : '';
  return rawAssignmentNoShow(a) && !rawAssignmentNoShow(b);
}

function resolveWorkerUidFromAssignment(data: Record<string, unknown>): string | null {
  const uid = String(data.userId || data.candidateId || '').trim();
  return uid || null;
}

function logProcessorError(context: string, err: unknown, extra: Record<string, unknown>): void {
  if (err instanceof HttpsError && err.code === 'failed-precondition') {
    logger.warn(`categoryScoreEvolution.${context}.skip`, { ...extra, message: err.message });
    return;
  }
  logger.error(`categoryScoreEvolution.${context}.failed`, {
    ...extra,
    err: err instanceof Error ? err.message : String(err),
  });
}

/** Idempotent replays are expected; keep them at debug to avoid noisy/high-volume logs. */
function logCategoryScoreEmitted(
  label: 'bg' | 'shift_completion' | 'no_show',
  duplicate: boolean,
  emittedInfo: Record<string, unknown>,
): void {
  if (duplicate) {
    logger.debug(`categoryScoreEvolution.${label}.duplicate_idempotent`, emittedInfo);
  } else {
    logger.info(`categoryScoreEvolution.${label}.emitted`, emittedInfo);
  }
}

/**
 * Positive signal: screening / order reached a completed-ready state (per backgroundChecks doc).
 * Idempotency: one event per backgroundChecks document.
 */
export async function maybeEmitCategoryScoreOnBackgroundCheckWrite(
  db: admin.firestore.Firestore,
  checkId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!backgroundCheckJustCompleted(before, after)) return;
  const uid = String(after?.candidateId || '').trim();
  if (!uid) {
    logger.warn('categoryScoreEvolution.bg.skip_no_candidateId', { checkId });
    return;
  }
  try {
    const result = await applyCategoryScoreEventInternal(db, {
      uid,
      source: 'background_check',
      idempotencyKey: `background_check_completed:${checkId}`,
      referenceId: checkId,
      categoryDeltas: {
        jobReadiness: 4,
        reliability: 2,
      },
    });
    logCategoryScoreEmitted('bg', result.duplicate, {
      checkId,
      uid,
      bootstrapped: result.bootstrappedFromInterview,
    });
  } catch (err) {
    logProcessorError('bg', err, { checkId, uid });
  }
}

/**
 * shift_completion: assignment status moves to completed/ended.
 * no_show: assignment status moves to no_show / no-show.
 */
export async function maybeEmitCategoryScoreOnAssignmentWrite(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  if (!after) return;
  // No relevant transition → skip before resolving uid (hot path for non-terminal assignment writes).
  if (!assignmentJustCompleted(before, after) && !assignmentJustMarkedNoShow(before, after)) {
    return;
  }

  const uid = resolveWorkerUidFromAssignment(after);
  if (!uid) {
    logger.warn('categoryScoreEvolution.assignment.skip_no_uid', { tenantId, assignmentId });
    return;
  }

  if (assignmentJustCompleted(before, after)) {
    try {
      const result = await applyCategoryScoreEventInternal(db, {
        uid,
        source: 'shift_completion',
        idempotencyKey: `shift_completion:${tenantId}:${assignmentId}`,
        referenceId: assignmentId,
        categoryDeltas: {
          punctuality: 3,
          reliability: 2,
          workEthic: 1,
        },
      });
      logCategoryScoreEmitted('shift_completion', result.duplicate, {
        tenantId,
        assignmentId,
        uid,
        bootstrapped: result.bootstrappedFromInterview,
      });
    } catch (err) {
      logProcessorError('shift_completion', err, { tenantId, assignmentId, uid });
    }
    return;
  }

  if (assignmentJustMarkedNoShow(before, after)) {
    try {
      const result = await applyCategoryScoreEventInternal(db, {
        uid,
        source: 'no_show',
        idempotencyKey: `no_show:${tenantId}:${assignmentId}`,
        referenceId: assignmentId,
        categoryDeltas: {
          reliability: -5,
          punctuality: -3,
        },
      });
      logCategoryScoreEmitted('no_show', result.duplicate, {
        tenantId,
        assignmentId,
        uid,
        bootstrapped: result.bootstrappedFromInterview,
      });
    } catch (err) {
      logProcessorError('no_show', err, { tenantId, assignmentId, uid });
    }
  }
}
