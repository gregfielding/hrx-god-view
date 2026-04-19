/**
 * Builds `users/{uid}.recruiterMasterScore` — canonical blended recruiter score for all UI.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { RecruiterMasterScore } from '../shared/recruiterMasterScore';
import { computeRecruiterMasterScore } from '../shared/recruiterMasterScore';
import { extractPrescreenAnswersFromInterviewDoc } from '../workerAiPrescreen/extractPrescreenAnswersFromInterviewDoc';
import type { RecruiterScoreSnapshotGeneratedBy } from './buildRecruiterScoreSnapshot';

async function loadLatestPrescreenForMaster(
  db: Firestore,
  uid: string,
): Promise<{
  prescreenAi: Record<string, unknown> | null;
  snapshotCategoryFallback: Record<string, number | null> | null;
  transportationPlan: string | null;
}> {
  const interviewsRef = db.collection('users').doc(uid).collection('interviews');
  let snap;
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
  if (!doc) {
    return { prescreenAi: null, snapshotCategoryFallback: null, transportationPlan: null };
  }
  const data = doc.data() as Record<string, unknown>;
  const ai = data?.ai;
  const prescreenAi = ai && typeof ai === 'object' ? (ai as Record<string, unknown>) : null;
  const extracted = extractPrescreenAnswersFromInterviewDoc(data);
  const plan = extracted.answers?.transportation_plan != null
    ? String(extracted.answers.transportation_plan)
    : null;

  let snapshotCategoryFallback: Record<string, number | null> | null = null;
  if (prescreenAi?.categoryScores && typeof prescreenAi.categoryScores === 'object') {
    const cs = prescreenAi.categoryScores as Record<string, unknown>;
    snapshotCategoryFallback = {
      reliability: finite(cs.reliability),
      punctuality: finite(cs.punctuality),
      workEthic: finite(cs.workEthic),
      teamFit: finite(cs.teamFit),
      jobReadiness: finite(cs.jobReadiness),
      stability: finite(cs.stability),
    };
  }

  return { prescreenAi, snapshotCategoryFallback, transportationPlan: plan };
}

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

export type RecruiterMasterScoreDoc = RecruiterMasterScore & {
  updatedAt?: unknown;
  generatedBy?: RecruiterScoreSnapshotGeneratedBy;
};

export async function buildRecruiterMasterScoreForUserDoc(
  db: Firestore,
  uid: string,
  generatedBy: RecruiterScoreSnapshotGeneratedBy,
): Promise<RecruiterMasterScoreDoc> {
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = (userSnap.data() || {}) as Record<string, unknown>;
  const { prescreenAi, snapshotCategoryFallback, transportationPlan } = await loadLatestPrescreenForMaster(db, uid);

  const snap = userData.recruiterScoreSnapshot as { categoryScores?: Record<string, number | null> } | undefined;
  const snapCats = snap?.categoryScores && typeof snap.categoryScores === 'object' ? snap.categoryScores : null;

  const mergedFallback =
    snapshotCategoryFallback && snapCats
      ? { ...snapCats, ...snapshotCategoryFallback }
      : snapCats ?? snapshotCategoryFallback;

  const master = computeRecruiterMasterScore({
    userData,
    prescreenAi,
    snapshotCategoryScores: mergedFallback,
    prescreenTransportationPlan: transportationPlan,
  });

  return {
    ...master,
    generatedBy,
  };
}
