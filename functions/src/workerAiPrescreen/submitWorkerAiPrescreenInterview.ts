/**
 * Worker submits AI pre-screen; server scores, writes users/{uid}/interviews/{id}, updates scoreSummary.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import type { WorkerAiPrescreenAnswers } from './scoreWorkerAiPrescreen';
import { evaluateAiPrescreenEligibility } from './evaluateAiPrescreenEligibility';
import { recomputeUserInterviewScoreSummary } from './recomputeInterviewScoreSummary';
import { WORKER_AI_PRESCREEN_PROMPTS } from './prescreenQuestionLabels';
import type { AiInterviewContext } from './aiInterviewContextTypes';
import { buildAiInterviewContext } from './buildAiInterviewContext';
import { buildDynamicPrescreenSteps } from './buildDynamicPrescreenQuestions';
import type { DynamicAnswerValue } from './evaluateAiHiringDecision';
import { maybeWritePhase6AutomationQueue } from './phase6AiAutomationQueue';
import { composePrescreenAiBundle } from './composePrescreenAiBundle';
import {
  applyHiringLifecycleTimestampMetadata,
  buildHiringLifecycleOnInterviewSubmit,
} from '../shared/hiringLifecyclePatch';
import {
  firestoreSafeHiringLifecycle,
  hiringLifecycleCoreFromApplicationData,
} from '../shared/hiringLifecycleFirestore';

const REQUIRED_KEYS = [
  'motivation',
  'experience_details',
  'work_confidence',
  'pressure_situation',
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
const DYNAMIC_ANSWER_VALUES = new Set(['yes', 'no', 'not_sure']);

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

function parseDynamicAnswers(raw: unknown, allowedIds: Set<string>): Record<string, string> {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpsError('invalid-argument', 'dynamicAnswers must be an object');
  }
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = String(k).trim().slice(0, 200);
    if (!key) continue;
    if (!allowedIds.has(key)) {
      throw new HttpsError('invalid-argument', `Unknown dynamicAnswers key: ${key}`);
    }
    if (typeof v !== 'string') {
      throw new HttpsError('invalid-argument', `dynamicAnswers.${key} must be a string`);
    }
    const norm = v.trim().toLowerCase().replace(/\s+/g, '_');
    if (!DYNAMIC_ANSWER_VALUES.has(norm)) {
      throw new HttpsError('invalid-argument', `Invalid answer for ${key} (use yes, no, or not sure)`);
    }
    out[key] = norm;
  }
  return out;
}

function questionTypeForKey(key: string): 'text' | 'single_select' | 'multi_select' {
  if (key === 'work_confidence') return 'multi_select';
  if (
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

/** Omit core rows that were skipped in UI (conditionals) or replaced by job-specific dynamic steps (dedupe). */
function shouldOmitCoreQuestionFromStoredInterview(
  key: (typeof REQUIRED_KEYS)[number],
  answers: WorkerAiPrescreenAnswers,
  dynamicStepIds: Set<string>,
): boolean {
  if (key === 'attendance_explanation' && normLower(answers.attendance_issues) !== 'yes') return true;
  if (key === 'drug_screen' && dynamicStepIds.has('dyn_job_drug_screen')) return true;
  if (key === 'background_check' && dynamicStepIds.has('dyn_job_background_check')) return true;
  return false;
}

export const submitWorkerAiPrescreenInterview = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '512MiB' },
  async (request) => {
    const auth = request.auth;
    if (!auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const data = request.data as {
      answers?: unknown;
      applicationId?: unknown;
      tenantId?: unknown;
      dynamicAnswers?: unknown;
    };
    const answers = parseAnswers(data.answers);
    const applicationIdRaw = data.applicationId;
    const applicationId =
      applicationIdRaw == null || applicationIdRaw === ''
        ? null
        : String(applicationIdRaw).trim().slice(0, 200) || null;
    const tenantIdHint =
      data.tenantId == null || data.tenantId === ''
        ? null
        : String(data.tenantId).trim().slice(0, 120) || null;

    const db = admin.firestore();
    const userRef = db.collection('users').doc(auth.uid);
    const userSnap = await userRef.get();
    const ud = (userSnap.data() || {}) as Record<string, unknown>;

    let interviewContext: AiInterviewContext | null = null;
    if (applicationId) {
      interviewContext = await buildAiInterviewContext(db, {
        userId: auth.uid,
        applicationId,
        tenantId: tenantIdHint,
      });
    }

    const pe = interviewContext?.businessRules?.aiPrescreen;
    const eligibility = evaluateAiPrescreenEligibility(ud, {
      requireResumeOrSkill: pe?.eligibility.requireResumeOrSkill ?? true,
      requirePhone: pe?.eligibility.requirePhone ?? true,
      requireLocation: pe?.eligibility.requireLocation ?? true,
      requireWorkAuthorization: pe?.eligibility.requireWorkAuthorization ?? true,
    });
    logger.info('submitWorkerAiPrescreenInterview.eligibility', {
      userId: auth.uid,
      applicationId,
      eligibleForInterview: eligibility.eligibleForInterview,
      reason: eligibility.reason,
      missingFields: eligibility.missingFields,
    });

    let dynamicSteps: ReturnType<typeof buildDynamicPrescreenSteps> = [];
    let dynamicAnswers: Record<string, string> = {};
    let dynamicStepIds = new Set<string>();
    if (interviewContext) {
      dynamicSteps = buildDynamicPrescreenSteps(interviewContext);
      dynamicStepIds = new Set(dynamicSteps.map((s) => s.id));
      dynamicAnswers = parseDynamicAnswers(data.dynamicAnswers, dynamicStepIds);
    }

    const interviewsCol = userRef.collection('interviews');
    const interviewRef = interviewsCol.doc();
    const interviewId = interviewRef.id;

    const bundle = await composePrescreenAiBundle({
      db,
      userId: auth.uid,
      answers,
      dynamicAnswers,
      interviewContext,
      applicationId,
      tenantIdHint,
      interviewId,
      userDoc: ud,
    });
    const {
      scored,
      aiBlockCore,
      hiringResult,
      applicationNoShowRisk,
      orchestratorV1Firestore,
      priorityBucket,
      recommendedActions,
      aiFlags,
      score10,
    } = bundle;

    const assignmentReadiness = aiBlockCore.assignmentReadiness as { status?: string };
    const confidenceScore = aiBlockCore.confidenceScore as number;

    logger.info('worker_ai_prescreen.scored', {
      userId: auth.uid,
      interviewKind: 'worker_ai_prescreen',
      applicationId,
      overallScore: scored.overallScore,
      recommendation: scored.recommendation,
      flags: aiFlags,
      confidenceScore,
      assignmentReadiness: assignmentReadiness?.status,
      gigEligible: (aiBlockCore.alternatePaths as { gigEligible?: boolean })?.gigEligible === true,
    });
    const fn = String(ud.firstName || '').trim();
    const ln = String(ud.lastName || '').trim();
    const createdByName = fn || ln ? `${fn} ${ln}`.trim() : 'Worker';

    const questions = [
      ...REQUIRED_KEYS.filter((id) => !shouldOmitCoreQuestionFromStoredInterview(id, answers, dynamicStepIds)).map(
        (id) => ({
          id,
          question: WORKER_AI_PRESCREEN_PROMPTS[id] || id,
          answer: formatAnswerForStorage(id, answers),
          type: questionTypeForKey(id),
        }),
      ),
      ...dynamicSteps.map((step) => ({
        id: step.id,
        question: step.prompt,
        answer: dynamicAnswers[step.id] ?? '',
        type: 'single_select' as const,
      })),
    ];

    const now = admin.firestore.FieldValue.serverTimestamp();
    const aiBlock: Record<string, unknown> = {
      ...aiBlockCore,
      model: 'rules_v1',
      computedAt: now,
    };

    const tenantIdForApp = interviewContext?.businessRules?.tenant ?? tenantIdHint ?? null;

    logger.info('worker_ai_automation.phase1', {
      userId: auth.uid,
      applicationId: applicationId ?? null,
      interviewId,
      decision: hiringResult.decision,
      priorityBucket,
      recommendedActions,
      reasonCodes: hiringResult.reasonCodes,
      score: scored.overallScore,
    });

    const jobIdFromContext =
      interviewContext?.sources?.jobPostingId != null && String(interviewContext.sources.jobPostingId).trim() !== ''
        ? String(interviewContext.sources.jobPostingId).trim()
        : interviewContext?.assignment?.jobId
          ? String(interviewContext.assignment.jobId)
          : null;
    const jobOrderIdFromContext =
      interviewContext?.sources?.jobOrderId != null && String(interviewContext.sources.jobOrderId).trim() !== ''
        ? String(interviewContext.sources.jobOrderId).trim()
        : interviewContext?.assignment?.jobOrderId != null &&
            String(interviewContext.assignment.jobOrderId).trim() !== ''
          ? String(interviewContext.assignment.jobOrderId).trim()
          : null;

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
      jobId: jobIdFromContext,
      ...(jobOrderIdFromContext ? { jobOrderId: jobOrderIdFromContext } : {}),
      assignmentId: null,
      companyId: null,
      questions,
      notes: '',
      score10,
      isArchived: false,
      ai: aiBlock,
    };

    await interviewRef.set(interviewPayload);

    if (applicationId && tenantIdForApp) {
      const appRef = db.doc(`tenants/${tenantIdForApp}/applications/${applicationId}`);
      let prevLifecycleCore = null as ReturnType<typeof hiringLifecycleCoreFromApplicationData>;
      try {
        const prevSnap = await appRef.get();
        const prevData = prevSnap.exists ? (prevSnap.data() as Record<string, unknown>) : undefined;
        prevLifecycleCore = hiringLifecycleCoreFromApplicationData(prevData);
      } catch {
        /* best-effort — dual-write still proceeds */
      }

      try {
        await appRef.set(
          {
            aiAutomation: {
              lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
              sourceInterviewId: interviewId,
              decision: hiringResult.decision,
              eligibleForAutoAdvance: hiringResult.eligibleForAutoAdvance,
              priorityBucket,
              recommendedActions,
              reasonCodes: hiringResult.reasonCodes,
              score: scored.overallScore,
              noShowRisk: {
                engineVersion: applicationNoShowRisk.engineVersion,
                score: applicationNoShowRisk.score,
                band: applicationNoShowRisk.band,
                reasons: applicationNoShowRisk.reasons,
                recommendedAction: applicationNoShowRisk.recommendedAction,
                computedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              ...(orchestratorV1Firestore ? { orchestratorV1: orchestratorV1Firestore } : {}),
            },
            workerAiPrescreenInterviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
            workerAiPrescreenChase1Pending: false,
            workerAiPrescreenChase2Pending: false,
            workerAiPrescreenChase1DueAt: admin.firestore.FieldValue.delete(),
            workerAiPrescreenChase2DueAt: admin.firestore.FieldValue.delete(),
          },
          { merge: true },
        );

        let phase6AutomationQueued = false;
        if (interviewContext?.hiringPolicy) {
          try {
            phase6AutomationQueued = await maybeWritePhase6AutomationQueue({
              db,
              tenantId: tenantIdForApp,
              applicationId,
              userId: auth.uid,
              interviewId,
              score: scored.overallScore,
              hiringResult,
              resolvedPolicy: interviewContext.hiringPolicy.resolvedAiHiring,
              container: interviewContext.hiringPolicy.container,
            });
          } catch (e) {
            logger.warn('submitWorkerAiPrescreenInterview.phase6_queue_failed', {
              userId: auth.uid,
              applicationId,
              tenantId: tenantIdForApp,
              message: e instanceof Error ? e.message : String(e),
            });
          }
        }

        try {
          const { hiringLifecycle: hlCore } = buildHiringLifecycleOnInterviewSubmit({
            hiringResult,
            phase6AutomationQueued,
          });
          const hiringLifecycleFull = applyHiringLifecycleTimestampMetadata({
            core: hlCore,
            previous: prevLifecycleCore,
            nowIso: new Date().toISOString(),
          });
          await appRef.set(
            { hiringLifecycle: firestoreSafeHiringLifecycle(hiringLifecycleFull) },
            { merge: true },
          );
        } catch (eHl) {
          logger.warn('submitWorkerAiPrescreenInterview.hiringLifecycle_write_failed', {
            userId: auth.uid,
            applicationId,
            tenantId: tenantIdForApp,
            message: eHl instanceof Error ? eHl.message : String(eHl),
          });
        }
      } catch (e) {
        logger.warn('submitWorkerAiPrescreenInterview.aiAutomation_write_failed', {
          userId: auth.uid,
          applicationId,
          tenantId: tenantIdForApp,
          message: e instanceof Error ? e.message : String(e),
        });
        try {
          await appRef.set(
            {
              workerAiPrescreenInterviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
              workerAiPrescreenChase1Pending: false,
              workerAiPrescreenChase2Pending: false,
              workerAiPrescreenChase1DueAt: admin.firestore.FieldValue.delete(),
              workerAiPrescreenChase2DueAt: admin.firestore.FieldValue.delete(),
            },
            { merge: true },
          );
        } catch (e2) {
          logger.warn('submitWorkerAiPrescreenInterview.chase_clear_failed', {
            userId: auth.uid,
            applicationId,
            tenantId: tenantIdForApp,
            message: e2 instanceof Error ? e2.message : String(e2),
          });
        }
      }
    } else if (applicationId && !tenantIdForApp) {
      logger.warn('submitWorkerAiPrescreenInterview.aiAutomation_skipped_no_tenant', {
        userId: auth.uid,
        applicationId,
      });
    }

    try {
      await recomputeUserInterviewScoreSummary(db, auth.uid);
    } catch (e) {
      logger.warn('submitWorkerAiPrescreenInterview.scoreSummary_failed', {
        uid: auth.uid,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      ok: true,
      interviewId,
      overallScore: scored.overallScore,
      recommendation: scored.recommendation,
      assignmentReadiness: aiBlockCore.assignmentReadiness,
      alternatePaths: aiBlockCore.alternatePaths,
      hiringDecision: {
        decision: hiringResult.decision,
        eligibleForAutoAdvance: hiringResult.eligibleForAutoAdvance,
        reasonCodes: hiringResult.reasonCodes,
      },
    };
  },
);
