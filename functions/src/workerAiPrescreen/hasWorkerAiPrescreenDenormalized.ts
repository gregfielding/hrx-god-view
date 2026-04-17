/**
 * Denormalized `hasWorkerAiPrescreenInterview` on users/{uid} avoids per-request
 * scans of users/{uid}/interviews for suppression and eligibility.
 *
 * Backfill: older users may lack the flag; use {@link userHasWorkerAiPrescreenWithFallback}
 * which falls back to `interviewStatus === 'completed'` then a capped subcollection scan.
 */

import * as admin from 'firebase-admin';

const WORKER_AI_PRESCREEN = 'worker_ai_prescreen';
const INTERVIEWS_SCAN_LIMIT = 50;

/** True when user doc already indicates a completed prescreen (denormalized or legacy). */
export function userDocIndicatesWorkerAiPrescreen(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  if (data.hasWorkerAiPrescreenInterview === true) return true;
  if (data.interviewStatus === 'completed') return true;
  return false;
}

/**
 * Subcollection scan — only when user doc has no prescreen signal.
 * Fail open (false) on read errors so we do not suppress invites incorrectly.
 */
export async function scanInterviewsSubcollectionForWorkerAiPrescreen(
  userRef: admin.firestore.DocumentReference,
): Promise<boolean> {
  try {
    const snap = await userRef.collection('interviews').limit(INTERVIEWS_SCAN_LIMIT).get();
    for (const d of snap.docs) {
      if (String((d.data() as { interviewKind?: string }).interviewKind || '') === WORKER_AI_PRESCREEN) {
        return true;
      }
    }
  } catch {
    /* fail open */
  }
  return false;
}

/**
 * Canonical: flag or legacy interviewStatus; otherwise capped interviews scan.
 */
export async function userHasWorkerAiPrescreenWithFallback(
  userRef: admin.firestore.DocumentReference,
  data: Record<string, unknown> | undefined,
): Promise<boolean> {
  if (userDocIndicatesWorkerAiPrescreen(data)) return true;
  return scanInterviewsSubcollectionForWorkerAiPrescreen(userRef);
}
