/**
 * Worker submits AI pre-screen; server scores, writes users/{uid}/interviews/{id}, updates scoreSummary.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { scoreWorkerAiPrescreen, type WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import { evaluateAiPrescreenEligibility } from './evaluateAiPrescreenEligibility';
import { recomputeUserInterviewScoreSummary } from './recomputeInterviewScoreSummary';
import { WORKER_AI_PRESCREEN_PROMPTS } from './prescreenQuestionLabels';

const REQUIRED_KEYS = [
  'motivation',
  'similar_experience',
  'experience_details',
  'work_confidence',
  'attendance_issues',
  'attendance_explanation',
  'transportation_plan',
  'backup_transportation',
  'physical_comfort',
  'drug_screen',
  'background_check',
  'supervisor_feedback',
  'additional_notes',
] as const;

const ALLOWED_SIMILAR = new Set(['yes', 'no']);
const ALLOWED_ATTENDANCE_ISSUES = new Set(['yes', 'no']);
const ALLOWED_TRANSPORT = new Set([
  'own_vehicle',
  'ride_from_someone_else',
  'public_transportation',
  'walk_bike',
  'not_sure_yet',
  'other',
]);
const ALLOWED_BACKUP = new Set(['yes', 'no']);
const ALLOWED_PHYSICAL = new Set(['yes', 'no']);
const ALLOWED_DRUG_BG = new Set(['no', 'yes', 'not_sure']);

function normLower(s: unknown): string {
  return String(s ?? '').trim().toLowerCase();
}

function parseAnswers(raw: unknown): WorkerAiPrescreenAnswers {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'answers must be an object');
  }
  const o = raw as Record<string, unknown>;
  const out: WorkerAiPrescreenAnswers = {};

  for (const key of REQUIRED_KEYS) {
    const v = o[key];
    if (key === 'work_confidence') {
      if (!Array.isArray(v)) {
        throw new HttpsError('invalid-argument', 'work_confidence must be an array of strings');
      }
      out.work_confidence = v.map((x) => String(x).trim()).filter(Boolean);
      continue;
    }
    if (typeof v !== 'string') {
      throw new HttpsError('invalid-argument', `Missing or invalid field: ${key}`);
    }
    (out as Record<string, string>)[key] = String(v).trim();
  }

  const sim = normLower(out.similar_experience);
  if (!ALLOWED_SIMILAR.has(sim)) throw new HttpsError('invalid-argument', 'similar_experience must be Yes or No');

  const att = normLower(out.attendance_issues);
  if (!ALLOWED_ATTENDANCE_ISSUES.has(att)) {
    throw new HttpsError('invalid-argument', 'attendance_issues must be Yes or No');
  }

  const tp = normLower(out.transportation_plan);
  if (!ALLOWED_TRANSPORT.has(tp)) throw new HttpsError('invalid-argument', 'invalid transportation_plan');

  const bu = normLower(out.backup_transportation);
  if (!ALLOWED_BACKUP.has(bu)) throw new HttpsError('invalid-argument', 'backup_transportation must be Yes or No');

  const ph = normLower(out.physical_comfort);
  if (!ALLOWED_PHYSICAL.has(ph)) throw new HttpsError('invalid-argument', 'physical_comfort must be Yes or No');

  const drug = normLower(out.drug_screen).replace(/\s+/g, '_');
  if (!ALLOWED_DRUG_BG.has(drug)) throw new HttpsError('invalid-argument', 'drug_screen invalid');

  const bg = normLower(out.background_check).replace(/\s+/g, '_');
  if (!ALLOWED_DRUG_BG.has(bg)) throw new HttpsError('invalid-argument', 'background_check invalid');

  return out;
}

function formatAnswerForStorage(key: string, answers: WorkerAiPrescreenAnswers): string {
  if (key === 'work_confidence') {
    return (answers.work_confidence || []).join(', ');
  }
  return String((answers as Record<string, string>)[key] ?? '');
}

function questionTypeForKey(key: string): 'text' | 'single_select' | 'multi_select' {
  if (key === 'work_confidence') return 'multi_select';
  if (
    key === 'similar_experience' ||
    key === 'attendance_issues' ||
    key === 'transportation_plan' ||
    key === 'backup_transportation' ||
    key === 'physical_comfort' ||
    key === 'drug_screen' ||
    key === 'background_check'
  ) {
    return 'single_select';
  }
  return 'text';
}

export const submitWorkerAiPrescreenInterview = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '256MiB' },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const data = request.data as { answers?: unknown; applicationId?: unknown };
    const answers = parseAnswers(data.answers);
    const applicationIdRaw = data.applicationId;
    const applicationId =
      applicationIdRaw == null || applicationIdRaw === ''
        ? null
        : String(applicationIdRaw).trim().slice(0, 200) || null;

    const db = admin.firestore();
    const userRef = db.collection('users').doc(auth.uid);
    const userSnap = await userRef.get();
    const ud = (userSnap.data() || {}) as Record<string, unknown>;

    const eligibility = evaluateAiPrescreenEligibility(ud);
    logger.info('submitWorkerAiPrescreenInterview.eligibility', {
      userId: auth.uid,
      applicationId,
      eligibleForInterview: eligibility.eligibleForInterview,
      reason: eligibility.reason,
      missingFields: eligibility.missingFields,
    });

    const scored = scoreWorkerAiPrescreen(answers);
    const score10 = Math.max(0, Math.min(10, Math.round(scored.overallScore / 10)));

    logger.info('worker_ai_prescreen.scored', {
      userId: auth.uid,
      interviewKind: 'worker_ai_prescreen',
      applicationId,
      overallScore: scored.overallScore,
      recommendation: scored.recommendation,
      flags: scored.flags,
    });
    const fn = String(ud.firstName || '').trim();
    const ln = String(ud.lastName || '').trim();
    const createdByName = fn || ln ? `${fn} ${ln}`.trim() : 'Worker';

    const questions = REQUIRED_KEYS.map((id) => ({
      id,
      question: WORKER_AI_PRESCREEN_PROMPTS[id] || id,
      answer: formatAnswerForStorage(id, answers),
      type: questionTypeForKey(id),
    }));

    const now = admin.firestore.FieldValue.serverTimestamp();
    const aiBlock = {
      overallScore: scored.overallScore,
      recommendation: scored.recommendation,
      flags: scored.flags,
      subScores: scored.subScores,
      summary: scored.summary,
      model: 'rules_v1',
      computedAt: now,
    };

    const interviewPayload: Record<string, unknown> = {
      interviewKind: 'worker_ai_prescreen',
      applicationId,
      submittedBy: createdByName,
      submittedById: auth.uid,
      timestamp: now,
      score: score10,
      createdAt: now,
      createdByUid: auth.uid,
      createdByName,
      jobId: null,
      assignmentId: null,
      companyId: null,
      questions,
      notes: '',
      score10,
      isArchived: false,
      ai: aiBlock,
    };

    const interviewsCol = userRef.collection('interviews');
    await interviewsCol.add(interviewPayload);

    try {
      await recomputeUserInterviewScoreSummary(db, auth.uid);
    } catch (e) {
      logger.warn('submitWorkerAiPrescreenInterview.scoreSummary_failed', {
        uid: auth.uid,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    return { ok: true, overallScore: scored.overallScore, recommendation: scored.recommendation };
  },
);
