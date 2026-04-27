import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from './utils/logger';

const asNumber = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

async function assertInternalReviewer(uid: string): Promise<void> {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const data = snap.data() as any;
  const level = asNumber(data?.securityLevel) ?? asNumber(data?.tenantIds?.[data?.activeTenantId]?.securityLevel) ?? 0;
  if (level < 5) {
    throw new HttpsError('permission-denied', 'Only internal users (securityLevel >= 5) can write reviews.');
  }
}

export const getUserReviews = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');

  const uid = String(request.data?.uid || '');
  if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');

  // Reads are internal-only for now (matches MVP intent)
  await assertInternalReviewer(request.auth.uid);

  try {
    const ref = admin.firestore().collection('users').doc(uid).collection('reviews');
    const snap = await ref.orderBy('createdAt', 'desc').limit(100).get();
    const reviews = snap.docs.map((d) => {
      const data = d.data() as any;
      const createdAtMs = data?.createdAt?.toDate ? data.createdAt.toDate().getTime() : null;
      const updatedAtMs = data?.updatedAt?.toDate ? data.updatedAt.toDate().getTime() : null;
      return { id: d.id, ...data, createdAtMs, updatedAtMs };
    });
    return { reviews };
  } catch (err: any) {
    logger.error('getUserReviews failed', { uid, err: err?.message || String(err) });
    throw new HttpsError('internal', 'Failed to load reviews');
  }
});

const computeQualityScore = (interviewAvg: number | null, reviewAvg: number | null): number | null => {
  const hasInterview = typeof interviewAvg === 'number' && Number.isFinite(interviewAvg);
  const hasReview = typeof reviewAvg === 'number' && Number.isFinite(reviewAvg);
  if (!hasInterview && !hasReview) return null;

  const interviewScore100 = hasInterview ? (interviewAvg! / 10) * 100 : null;
  const reviewScore100 = hasReview ? ((reviewAvg! - 1) / 4) * 100 : null;

  const interviewWeight = hasInterview && hasReview ? 0.5 : hasInterview ? 1 : 0;
  const reviewWeight = hasInterview && hasReview ? 0.5 : hasReview ? 1 : 0;

  const raw = (interviewScore100 ?? 0) * interviewWeight + (reviewScore100 ?? 0) * reviewWeight;
  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped);
};

export const createUserReview = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');

  const uid = String(request.data?.uid || '');
  const stars5 = asNumber(request.data?.stars5);
  const title = typeof request.data?.title === 'string' ? request.data.title.trim() : '';
  const note = typeof request.data?.note === 'string' ? request.data.note.trim() : '';
  const visibility = (typeof request.data?.visibility === 'string' ? request.data.visibility : 'internal') as
    | 'internal'
    | 'shared_with_client'
    | 'worker_visible';

  if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
  if (!stars5 || stars5 < 1 || stars5 > 5) throw new HttpsError('invalid-argument', 'stars5 must be 1..5');

  await assertInternalReviewer(request.auth.uid);

  try {
    const actorSnap = await admin.firestore().doc(`users/${request.auth.uid}`).get();
    const actor = actorSnap.data() as any;
    const createdByName = actor?.displayName || actor?.fullName || actor?.email || 'Internal';

    const reviewRef = admin.firestore().collection('users').doc(uid).collection('reviews').doc();
    await reviewRef.set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: request.auth.uid,
      createdByName,
      reviewerType: 'internal',
      stars5,
      title: title || null,
      note: note || null,
      privateNote: null,
      visibility,
      status: 'active',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedByUid: request.auth.uid,
    });

    // Recompute denormalized score summary (reviews only)
    const all = await admin.firestore().collection('users').doc(uid).collection('reviews').get();
    const activeStars = all.docs
      .map((d) => d.data() as any)
      .filter((r) => r && r.status !== 'removed')
      .map((r) => (typeof r.stars5 === 'number' ? r.stars5 : Number(r.stars5)))
      .filter((n) => Number.isFinite(n));

    const reviewCount = activeStars.length;
    const reviewAvg = reviewCount ? Math.round(((activeStars.reduce((a, b) => a + b, 0) / reviewCount) * 10)) / 10 : null;
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const existing = (userSnap.data() as any)?.scoreSummary || {};
    const interviewAvg = typeof existing?.interviewAvg === 'number' ? existing.interviewAvg : null;
    const qualityScore = computeQualityScore(interviewAvg, reviewAvg);

    await admin.firestore().doc(`users/${uid}`).set(
      {
        scoreSummary: {
          reviewAvg,
          reviewCount,
          reviewLastAt: admin.firestore.FieldValue.serverTimestamp(),
          qualityScore,
        },
      },
      { merge: true }
    );

    return { id: reviewRef.id, reviewAvg, reviewCount };
  } catch (err: any) {
    logger.error('createUserReview failed', { uid, err: err?.message || String(err) });
    throw new HttpsError('internal', 'Failed to create review');
  }
});

export const deleteUserReview = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');

  const uid = String(request.data?.uid || '');
  const reviewId = String(request.data?.reviewId || '');
  if (!uid) throw new HttpsError('invalid-argument', 'Missing uid');
  if (!reviewId) throw new HttpsError('invalid-argument', 'Missing reviewId');

  await assertInternalReviewer(request.auth.uid);

  try {
    const reviewRef = admin.firestore().collection('users').doc(uid).collection('reviews').doc(reviewId);
    await reviewRef.set(
      {
        status: 'removed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByUid: request.auth.uid,
      },
      { merge: true }
    );

    // Recompute summary
    const all = await admin.firestore().collection('users').doc(uid).collection('reviews').get();
    const activeStars = all.docs
      .map((d) => d.data() as any)
      .filter((r) => r && r.status !== 'removed')
      .map((r) => (typeof r.stars5 === 'number' ? r.stars5 : Number(r.stars5)))
      .filter((n) => Number.isFinite(n));

    const reviewCount = activeStars.length;
    const reviewAvg = reviewCount ? Math.round(((activeStars.reduce((a, b) => a + b, 0) / reviewCount) * 10)) / 10 : null;
    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const existing = (userSnap.data() as any)?.scoreSummary || {};
    const interviewAvg = typeof existing?.interviewAvg === 'number' ? existing.interviewAvg : null;
    const qualityScore = computeQualityScore(interviewAvg, reviewAvg);

    await admin.firestore().doc(`users/${uid}`).set(
      {
        scoreSummary: {
          reviewAvg,
          reviewCount,
          reviewLastAt: admin.firestore.FieldValue.serverTimestamp(),
          qualityScore,
        },
      },
      { merge: true }
    );

    return { ok: true };
  } catch (err: any) {
    logger.error('deleteUserReview failed', { uid, reviewId, err: err?.message || String(err) });
    throw new HttpsError('internal', 'Failed to delete review');
  }
});
