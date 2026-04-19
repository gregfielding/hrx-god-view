import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from './integrations/callableBrowserCors';
import { recomputeUserInterviewScoreSummary } from './workerAiPrescreen/recomputeInterviewScoreSummary';

function getMaxSecurityLevel(userData: Record<string, unknown>): number {
  const levels: number[] = [];
  const topLevel = Number.parseInt(String(userData?.securityLevel ?? '0'), 10);
  if (Number.isFinite(topLevel)) levels.push(topLevel);

  const tenantIds = userData?.tenantIds;
  if (tenantIds && typeof tenantIds === 'object') {
    Object.values(tenantIds as Record<string, unknown>).forEach((entry: unknown) => {
      const level = Number.parseInt(String((entry as { securityLevel?: unknown })?.securityLevel ?? '0'), 10);
      if (Number.isFinite(level)) levels.push(level);
    });
  }

  return levels.length > 0 ? Math.max(...levels) : 0;
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

/** Mirrors frontend `resolveRecruiterOperationalScore100` precedence using denormalized `scoreSummary` only. */
function primaryScoreFromSummary(ss: Record<string, unknown>): number | null {
  const o = finite(ss.overrideAdjustedScore);
  const b = finite(ss.baseInterviewScore);
  const last10 = finite(ss.interviewLastScore10);
  const kind = String(ss.interviewLastInterviewKind || '');
  const last10As100 =
    kind === 'worker_ai_prescreen' &&
    last10 != null &&
    typeof ss.interviewCount === 'number' &&
    (ss.interviewCount as number) > 0
      ? Math.round(Math.max(0, Math.min(100, last10 * 10)))
      : null;
  const composite = finite(ss.aiScore);
  return o ?? b ?? last10As100 ?? composite ?? null;
}

async function hasWorkerAiPrescreenInterview(
  db: admin.firestore.Firestore,
  userId: string,
): Promise<boolean> {
  const interviewsRef = db.collection('users').doc(userId).collection('interviews');
  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await interviewsRef.orderBy('createdAt', 'desc').limit(80).get();
  } catch {
    try {
      snap = await interviewsRef.orderBy('timestamp', 'desc').limit(80).get();
    } catch {
      snap = await interviewsRef.limit(80).get();
    }
  }
  return snap.docs.some((d) => String(d.data()?.interviewKind || '') === 'worker_ai_prescreen');
}

async function readLatestPrescreenLabels(
  db: admin.firestore.Firestore,
  userId: string,
): Promise<{ recommendation: string | null; hiringDecision: string | null }> {
  const interviewsRef = db.collection('users').doc(userId).collection('interviews');
  let snap: admin.firestore.QuerySnapshot;
  try {
    snap = await interviewsRef.orderBy('createdAt', 'desc').limit(40).get();
  } catch {
    try {
      snap = await interviewsRef.orderBy('timestamp', 'desc').limit(40).get();
    } catch {
      snap = await interviewsRef.limit(40).get();
    }
  }
  const doc = snap.docs.find((d) => String(d.data()?.interviewKind || '') === 'worker_ai_prescreen');
  if (!doc) return { recommendation: null, hiringDecision: null };
  const ai = doc.data()?.ai as Record<string, unknown> | undefined;
  const recommendation = typeof ai?.recommendation === 'string' ? ai.recommendation : null;
  const hd = ai?.hiringDecision as { decision?: string } | undefined;
  const hiringDecision = typeof hd?.decision === 'string' ? hd.decision : null;
  return { recommendation, hiringDecision };
}

/**
 * Manual one-shot: recompute recruiter-facing score summary + risk for a single user via the same path as batch/backfill.
 * Callable only — not invoked from page loads or Firestore triggers.
 */
export const reviewAndRescoreUser = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS },
  async (request) => {
    const actorUid = request.auth?.uid;
    if (!actorUid) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }

    const userId = String(request.data?.userId ?? '').trim();
    if (!userId) {
      throw new HttpsError('invalid-argument', 'Missing userId.');
    }

    // Optional passthrough for clients / future tenant scoping; not required for recompute.
    const _tenantId = request.data?.tenantId != null ? String(request.data.tenantId).trim() : '';
    void _tenantId;

    // `force` accepted for API compatibility; canonical recompute is already idempotent for unchanged inputs.
    void request.data?.force;

    const db = admin.firestore();
    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorLevel = getMaxSecurityLevel((actorSnap.exists ? actorSnap.data() : {}) as Record<string, unknown>);
    if (actorLevel < 5) {
      throw new HttpsError('permission-denied', 'Only internal users with scoring access can rescore.');
    }

    const targetSnap = await db.collection('users').doc(userId).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'User not found.');
    }

    let hadPrescreenInterview = false;
    try {
      hadPrescreenInterview = await hasWorkerAiPrescreenInterview(db, userId);
    } catch (e) {
      logger.warn('reviewAndRescoreUser.prescreen_probe_failed', {
        userId,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await recomputeUserInterviewScoreSummary(db, userId, {
        recruiterSnapshotGeneratedBy: 'manual_review',
      });
    } catch (e) {
      logger.error('reviewAndRescoreUser.recompute_failed', {
        userId,
        message: e instanceof Error ? e.message : String(e),
      });
      throw new HttpsError('internal', 'Failed to recompute score summary.');
    }

    const afterSnap = await db.collection('users').doc(userId).get();
    const after = (afterSnap.data() || {}) as Record<string, unknown>;
    const ss = (after.scoreSummary as Record<string, unknown>) || {};
    const primaryScore = primaryScoreFromSummary(ss);
    const scoreSource = typeof ss.primaryRecruiterScoreSource === 'string' ? ss.primaryRecruiterScoreSource : null;

    const ts = ss.primaryRecruiterScoreUpdatedAt as admin.firestore.Timestamp | undefined;
    const aiUpdated = ss.aiScoreUpdatedAt as admin.firestore.Timestamp | undefined;
    const updatedAt =
      ts?.toDate?.()?.toISOString?.() ??
      aiUpdated?.toDate?.()?.toISOString?.() ??
      new Date().toISOString();

    let recommendation: string | null = null;
    let hiringDecision: string | null = null;
    try {
      const labels = await readLatestPrescreenLabels(db, userId);
      recommendation = labels.recommendation;
      hiringDecision = labels.hiringDecision;
    } catch (e) {
      logger.warn('reviewAndRescoreUser.prescreen_labels_failed', {
        userId,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      ok: true,
      userId,
      hadPrescreenInterview,
      scoreSource,
      primaryScore,
      recommendation,
      hiringDecision,
      updatedAt,
    };
  },
);
