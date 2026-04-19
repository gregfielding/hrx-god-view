/**
 * Builds `users/{uid}.recruiterScoreSnapshot` from user doc + latest prescreen interview.
 * Single precedence: operationalScore100 > compositeScore100 > interviewScoreBase100 > null.
 */
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';

export type RecruiterScoreSnapshotGeneratedBy =
  | 'interview_submit'
  | 'rescore_script'
  | 'manual_review'
  | 'profile_refresh'
  | 'system';

export type RecruiterScoreSnapshotV1 = {
  version: 1;
  scoreKind: 'operational' | 'composite' | 'base_interview' | 'none';
  score100: number | null;
  grade: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  decision: 'advance' | 'review' | 'reject' | 'hold' | null;
  recommendation: 'proceed' | 'review' | 'caution' | 'decline' | null;
  riskLevel: 'low' | 'medium' | 'high' | null;
  riskSummary: string | null;
  reasoningSummary: string | null;
  categoryScores: Record<string, number | null>;
  interviewScoreBase100: number | null;
  operationalScore100: number | null;
  compositeScore100: number | null;
  sourceInterviewId: string | null;
  sourceModel: string | null;
  generatedBy: RecruiterScoreSnapshotGeneratedBy;
  inputSignature: string | null;
};

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null;
}

/** Same thresholds as `recruiterTableLetterGrade` in web app. */
export function scoreToRecruiterGrade(score100: number | null): string | null {
  if (score100 == null || !Number.isFinite(score100)) return null;
  const s = Math.round(Math.max(0, Math.min(100, score100)));
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 60) return 'D';
  return 'F';
}

function riskIndexToLevel(overallRiskScore: number | null): 'low' | 'medium' | 'high' | null {
  if (overallRiskScore == null || !Number.isFinite(overallRiskScore)) return null;
  if (overallRiskScore >= 70) return 'high';
  if (overallRiskScore >= 40) return 'medium';
  return 'low';
}

function buildRiskSummary(risk: Record<string, unknown> | null | undefined): string | null {
  if (!risk) return null;
  const top = risk.topRisks as Array<{ summary?: string }> | undefined;
  if (Array.isArray(top) && top.length > 0) {
    const line = top
      .map((t) => String(t?.summary || '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
    return line || null;
  }
  const score = finite(risk.overallRiskScore);
  if (score != null) return `Risk index ${score}`;
  return null;
}

function extractCategoryScoresFromUser(userData: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const cats = userData.categoryScoresCurrent as Record<string, unknown> | undefined;
  if (!cats || typeof cats !== 'object') return out;
  const v = cats.version;
  if (v === 2) {
    const keys = ['reliability', 'punctuality', 'workEthic', 'teamFit', 'jobReadiness', 'stability'] as const;
    for (const k of keys) {
      const entry = cats[k] as { score?: unknown } | undefined;
      out[k] = finite(entry?.score);
    }
  } else {
    for (const k of ['reliability', 'punctuality', 'workEthic', 'teamFit', 'jobReadiness', 'stability'] as const) {
      const n = finite(cats[k]);
      if (n != null) out[k] = n;
    }
  }
  return out;
}

function extractCategoryScoresFromAi(ai: Record<string, unknown> | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const cs = ai?.categoryScores as Record<string, unknown> | undefined;
  if (!cs || typeof cs !== 'object') return out;
  for (const k of ['reliability', 'punctuality', 'workEthic', 'teamFit', 'jobReadiness', 'stability'] as const) {
    const n = finite(cs[k]);
    if (n != null) out[k] = n;
  }
  return out;
}

export type BuildRecruiterScoreSnapshotInput = {
  userData: Record<string, unknown>;
  latestPrescreenInterviewId: string | null;
  prescreenAi: Record<string, unknown> | null;
  generatedBy: RecruiterScoreSnapshotGeneratedBy;
};

export function computeRecruiterScoreSnapshotInputSignature(payload: {
  operationalScore100: number | null;
  compositeScore100: number | null;
  interviewScoreBase100: number | null;
  sourceInterviewId: string | null;
  decision: string | null;
  recommendation: string | null;
  riskLevel: string | null;
  categoryScoresJson: string;
}): string {
  const raw = JSON.stringify(payload);
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/**
 * Pure builder from already-loaded user + optional prescreen interview AI.
 */
export function buildRecruiterScoreSnapshotV1(input: BuildRecruiterScoreSnapshotInput): RecruiterScoreSnapshotV1 {
  const { userData, latestPrescreenInterviewId, prescreenAi, generatedBy } = input;
  const ss = (userData.scoreSummary as Record<string, unknown>) || {};

  const operationalScore100 =
    finite(prescreenAi?.overrideAdjustedScore) ?? finite(ss.overrideAdjustedScore);
  const compositeScore100 = finite(ss.aiScore);
  const baseFromAi =
    finite(prescreenAi?.baseInterviewScore) ?? finite(prescreenAi?.overallScore) ?? finite(ss.baseInterviewScore);
  const interviewScoreBase100 = baseFromAi;

  let scoreKind: RecruiterScoreSnapshotV1['scoreKind'] = 'none';
  let score100: number | null = null;
  if (operationalScore100 != null) {
    scoreKind = 'operational';
    score100 = operationalScore100;
  } else if (compositeScore100 != null) {
    scoreKind = 'composite';
    score100 = compositeScore100;
  } else if (interviewScoreBase100 != null) {
    scoreKind = 'base_interview';
    score100 = interviewScoreBase100;
  }

  const grade = scoreToRecruiterGrade(score100);

  const hd = prescreenAi?.hiringDecision as { decision?: string } | undefined;
  const decRaw = typeof hd?.decision === 'string' ? hd.decision : null;
  const decision =
    decRaw === 'advance' || decRaw === 'review' || decRaw === 'reject' || decRaw === 'hold' ? decRaw : null;

  const recRaw = typeof prescreenAi?.recommendation === 'string' ? prescreenAi.recommendation : null;
  const recommendation =
    recRaw === 'proceed' || recRaw === 'review' || recRaw === 'caution' || recRaw === 'decline' ? recRaw : null;

  const risk = userData.riskProfile as Record<string, unknown> | undefined;
  const overallRisk = finite(risk?.overallRiskScore);
  const riskLevel = riskIndexToLevel(overallRisk);
  let riskSummary = buildRiskSummary(risk);
  const aiRisk = prescreenAi?.riskSummary as { drug?: { reason?: string }; background?: { reason?: string } } | undefined;
  if (!riskSummary && aiRisk && typeof aiRisk === 'object') {
    const parts = [aiRisk.drug?.reason, aiRisk.background?.reason].filter(Boolean).map(String);
    if (parts.length) riskSummary = parts.join(' · ');
  }

  const catFromUser = extractCategoryScoresFromUser(userData);
  const catFromAi = extractCategoryScoresFromAi(prescreenAi);
  const categoryScores: Record<string, number | null> = { ...catFromUser };
  for (const [k, v] of Object.entries(catFromAi)) {
    if (v != null && categoryScores[k] == null) categoryScores[k] = v;
  }

  let confidence: 'low' | 'medium' | 'high' | null = 'medium';
  if (scoreKind === 'operational') confidence = 'high';
  else if (scoreKind === 'none') confidence = null;
  else if (scoreKind === 'composite') confidence = 'medium';

  let reasoningSummary: string | null = null;
  if (scoreKind === 'operational') {
    reasoningSummary = 'Primary score uses operational prescreen rules (trust-adjusted interview score).';
  } else if (scoreKind === 'composite') {
    reasoningSummary = 'Primary score uses profile/composite hiring score (no operational prescreen layer).';
  } else if (scoreKind === 'base_interview') {
    reasoningSummary = 'Primary score uses raw interview model score (operational/composite unavailable).';
  } else {
    reasoningSummary = 'No score yet — complete profile or AI prescreen interview.';
  }

  const sourceModel = typeof prescreenAi?.model === 'string' ? prescreenAi.model : null;

  const sig = computeRecruiterScoreSnapshotInputSignature({
    operationalScore100,
    compositeScore100,
    interviewScoreBase100,
    sourceInterviewId: latestPrescreenInterviewId,
    decision,
    recommendation,
    riskLevel,
    categoryScoresJson: JSON.stringify(categoryScores),
  });

  return {
    version: 1,
    scoreKind,
    score100,
    grade,
    confidence,
    decision,
    recommendation,
    riskLevel,
    riskSummary,
    reasoningSummary,
    categoryScores,
    interviewScoreBase100,
    operationalScore100,
    compositeScore100,
    sourceInterviewId: latestPrescreenInterviewId,
    sourceModel,
    generatedBy,
    inputSignature: sig,
  };
}

async function loadLatestPrescreenInterview(
  db: Firestore,
  uid: string,
): Promise<{ id: string | null; ai: Record<string, unknown> | null }> {
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
  if (!doc) return { id: null, ai: null };
  const ai = doc.data()?.ai;
  return {
    id: doc.id,
    ai: ai && typeof ai === 'object' ? (ai as Record<string, unknown>) : null,
  };
}

export async function buildRecruiterScoreSnapshotForUserDoc(
  db: Firestore,
  uid: string,
  generatedBy: RecruiterScoreSnapshotGeneratedBy,
): Promise<RecruiterScoreSnapshotV1> {
  const userSnap = await db.collection('users').doc(uid).get();
  const userData = (userSnap.data() || {}) as Record<string, unknown>;
  const { id: prescreenId, ai } = await loadLatestPrescreenInterview(db, uid);
  return buildRecruiterScoreSnapshotV1({
    userData,
    latestPrescreenInterviewId: prescreenId,
    prescreenAi: ai,
    generatedBy,
  });
}
