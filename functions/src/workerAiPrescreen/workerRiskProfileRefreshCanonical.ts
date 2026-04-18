/**
 * Single canonical entry point for refreshing `users/{uid}.riskProfile` from latest interview + user snapshot.
 * Reuses `buildWorkerRiskProfileFromLatestInterview` + signature-guarded merge — no duplicated risk math.
 *
 * Intended for: admin scripts, callables, maintenance jobs — not blind Firestore triggers.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  buildWorkerRiskProfileFromLatestInterview,
  mergeRiskProfileIntoUserUpdateIfChanged,
} from './workerRiskProfile';

export type RefreshWorkerRiskProfileCanonicalStatus =
  | 'updated'
  | 'skipped_unchanged'
  | 'skipped_no_interview'
  | 'skipped_no_user'
  | 'dry_run_would_update'
  | 'error';

export type RefreshWorkerRiskProfileCanonicalResult = {
  status: RefreshWorkerRiskProfileCanonicalStatus;
  uid: string;
  reason: string;
  previousSignature?: string | null;
  newSignature?: string | null;
  overallRiskScore?: number;
  topRiskSummaries?: string[];
  errorMessage?: string;
};

export async function refreshWorkerRiskProfileForUidCanonical(
  db: Firestore,
  uid: string,
  opts?: { dryRun?: boolean },
): Promise<RefreshWorkerRiskProfileCanonicalResult> {
  const trimmed = String(uid || '').trim();
  if (!trimmed) {
    return { status: 'error', uid: '', reason: 'empty_uid', errorMessage: 'empty_uid' };
  }

  try {
    const userRef = db.collection('users').doc(trimmed);
    const snap = await userRef.get();
    if (!snap.exists) {
      return { status: 'skipped_no_user', uid: trimmed, reason: 'user_not_found' };
    }
    const ud = snap.data() as Record<string, unknown>;
    const prev = ud.riskProfile as { generationSignature?: string } | undefined;
    const previousSignature = prev?.generationSignature ?? null;

    const draft = await buildWorkerRiskProfileFromLatestInterview(db, trimmed, ud, 'system');
    if (!draft) {
      return {
        status: 'skipped_no_interview',
        uid: trimmed,
        reason: 'no_worker_ai_prescreen_interview_or_missing_ai',
        previousSignature,
      };
    }

    const newSignature = draft.generationSignature;
    const topRiskSummaries = draft.topRisks.map((r) => r.summary);
    const unchanged = previousSignature != null && previousSignature === newSignature;

    if (unchanged) {
      return {
        status: 'skipped_unchanged',
        uid: trimmed,
        reason: 'generation_signature_unchanged',
        previousSignature,
        newSignature,
        overallRiskScore: draft.overallRiskScore,
        topRiskSummaries,
      };
    }

    if (opts?.dryRun) {
      return {
        status: 'dry_run_would_update',
        uid: trimmed,
        reason: 'signature_changed_dry_run_no_write',
        previousSignature,
        newSignature,
        overallRiskScore: draft.overallRiskScore,
        topRiskSummaries,
      };
    }

    const merge = mergeRiskProfileIntoUserUpdateIfChanged(ud, draft, { touchUpdatedAt: true });
    if (!merge) {
      return {
        status: 'skipped_unchanged',
        uid: trimmed,
        reason: 'merge_skipped_after_recheck',
        previousSignature,
        newSignature,
        overallRiskScore: draft.overallRiskScore,
        topRiskSummaries,
      };
    }

    await userRef.update(merge);
    logger.info('workerRiskProfileRefreshCanonical.updated', {
      uid: trimmed,
      overallRiskScore: draft.overallRiskScore,
      signaturePrefix: newSignature.slice(0, 16),
    });

    return {
      status: 'updated',
      uid: trimmed,
      reason: 'written',
      previousSignature,
      newSignature,
      overallRiskScore: draft.overallRiskScore,
      topRiskSummaries,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('workerRiskProfileRefreshCanonical.error', { uid: trimmed, msg });
    return {
      status: 'error',
      uid: trimmed,
      reason: 'exception',
      errorMessage: msg,
    };
  }
}
