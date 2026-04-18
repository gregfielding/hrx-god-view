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
import { applyPrescreenDynamicDedupe } from './prescreenDynamicDedupe';
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
import {
  mergeEnrichedUserDocForPrescreenSubmit,
  parseSessionProfileEnhancements,
} from './mergeEnrichedUserDocForPrescreenSubmit';
import { PRESCREEN_OPENING_MULTI_SELECT_KEYS } from './prescreenOpeningKeys';
import { buildPrescreenOpeningProfilePatch } from './prescreenOpeningProfileWrite';
import { maybeEmitInterviewCompletedCategoryScores } from '../categoryScoreEvolution/activityCategoryScoreEmit';

const REQUIRED_KEYS = [
  ...PRESCREEN_OPENING_MULTI_SELECT_KEYS,
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

/** Optional core rows persisted when present / applicable. */
const OPTIONAL_CORE_STORED_KEYS = ['drug_screen_detail', 'background_check_detail'] as const;

const MULTI_SELECT_ANSWER_KEYS = new Set<string>(['work_confidence', ...PRESCREEN_OPENING_MULTI_SELECT_KEYS]);

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

/**
 * Optional `entry` query param from the prescreen URL (`buildWorkerAiPrescreenInviteUrl` / dashboard links).
 * Sanitized for Firestore; invalid values are dropped (submit still succeeds).
 */
function parseOptionalInterviewEntrySource(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.length > 120) return undefined;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return undefined;
  return s;
}

function parseAnswers(raw: unknown): WorkerAiPrescreenAnswers {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'answers must be an object');
  }
  const o = raw as Record<string, unknown>;
  const out: WorkerAiPrescreenAnswers = {};

  for (const key of REQUIRED_KEYS) {
    const v = o[key];
    if (MULTI_SELECT_ANSWER_KEYS.has(key)) {
      if (!Array.isArray(v)) {
        throw new HttpsError('invalid-argument', `${key} must be an array of strings`);
      }
      const arr = v.map((x) => String(x).trim()).filter(Boolean);
      (out as Record<string, unknown>)[key] = arr;
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

  const detail = (k: 'drug_screen_detail' | 'background_check_detail') => {
    const v = o[k];
    if (v === undefined || v === null) return;
    if (typeof v !== 'string') {
      throw new HttpsError('invalid-argument', `${k} must be a string`);
    }
    (out as Record<string, string>)[k] = String(v).trim();
  };
  detail('drug_screen_detail');
  detail('background_check_detail');

  return out;
}

const COMPLIANCE_DETAIL_MIN_CHARS = 15;

function validateComplianceDisclosureFollowUps(
  answers: WorkerAiPrescreenAnswers,
  dynamicStepIds: Set<string>,
): void {
  const drug = normLower(answers.drug_screen).replace(/\s+/g, '_');
  const bg = normLower(answers.background_check).replace(/\s+/g, '_');

  if (drug === 'yes' && !dynamicStepIds.has('dyn_job_drug_screen')) {
    const d = String(answers.drug_screen_detail ?? '').trim();
    if (d.length < COMPLIANCE_DETAIL_MIN_CHARS) {
      throw new HttpsError(
        'invalid-argument',
        `Please add a short explanation (${COMPLIANCE_DETAIL_MIN_CHARS}+ characters) for the drug screening question, or go back and change your answer.`,
      );
    }
  }
  if (bg === 'yes' && !dynamicStepIds.has('dyn_job_background_check')) {
    const d = String(answers.background_check_detail ?? '').trim();
    if (d.length < COMPLIANCE_DETAIL_MIN_CHARS) {
      throw new HttpsError(
        'invalid-argument',
        `Please add a short explanation (${COMPLIANCE_DETAIL_MIN_CHARS}+ characters) for the background check question, or go back and change your answer.`,
      );
    }
  }
}

function formatAnswerForStorage(key: string, answers: WorkerAiPrescreenAnswers): string {
  if (MULTI_SELECT_ANSWER_KEYS.has(key)) {
    const arr = (answers as Record<string, unknown>)[key];
    if (Array.isArray(arr)) {
      return arr.map((x) => String(x).trim()).filter(Boolean).join(', ');
    }
    return '';
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
  if (MULTI_SELECT_ANSWER_KEYS.has(key)) return 'multi_select';
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

function openingTargets(answers: WorkerAiPrescreenAnswers): Set<string> {
  return new Set((answers.opening_target_work_types || []).map((x) => String(x).trim()).filter(Boolean));
}

function openingSchedules(answers: WorkerAiPrescreenAnswers): Set<string> {
  return new Set((answers.opening_schedule_preferences || []).map((x) => String(x).trim()).filter(Boolean));
}

/** Omit opening follow-ups not shown in UI. */
function shouldOmitOpeningStoredQuestion(key: string, answers: WorkerAiPrescreenAnswers): boolean {
  const tw = openingTargets(answers);
  const sp = openingSchedules(answers);
  switch (key) {
    case 'opening_experience_industrial':
      return !tw.has('industrial');
    case 'opening_experience_hospitality':
      return !tw.has('hospitality');
    case 'opening_experience_events':
      return !tw.has('events');
    case 'opening_experience_clerical':
      return !tw.has('clerical_admin');
    case 'opening_experience_healthcare':
      return !tw.has('healthcare');
    case 'opening_gig_types':
      return !sp.has('gig_work');
    default:
      return false;
  }
}

/** Omit core rows that were skipped in UI (conditionals) or replaced by job-specific dynamic steps (dedupe). */
function shouldOmitCoreQuestionFromStoredInterview(
  key: string,
  answers: WorkerAiPrescreenAnswers,
  dynamicStepIds: Set<string>,
): boolean {
  if (shouldOmitOpeningStoredQuestion(key, answers)) return true;
  if (key === 'attendance_explanation' && normLower(answers.attendance_issues) !== 'yes') return true;
  if (key === 'drug_screen' && dynamicStepIds.has('dyn_job_drug_screen')) return true;
  if (key === 'background_check' && dynamicStepIds.has('dyn_job_background_check')) return true;
  if (key === 'drug_screen_detail' && normLower(answers.drug_screen) !== 'yes') return true;
  if (key === 'drug_screen_detail' && dynamicStepIds.has('dyn_job_drug_screen')) return true;
  if (key === 'background_check_detail' && normLower(answers.background_check) !== 'yes') return true;
  if (key === 'background_check_detail' && dynamicStepIds.has('dyn_job_background_check')) return true;
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
      /** Client snapshot of profile fields at submit time (merged with fresh server read for scoring). */
      sessionProfileEnhancements?: unknown;
      /** Prescreen URL `entry` query param (analytics / attribution). */
      entry?: unknown;
    };
    const answers = parseAnswers(data.answers);
    const sessionProfileEnhancements = parseSessionProfileEnhancements(data.sessionProfileEnhancements);
    const applicationIdRaw = data.applicationId;
    const applicationId =
      applicationIdRaw == null || applicationIdRaw === ''
        ? null
        : String(applicationIdRaw).trim().slice(0, 200) || null;
    const tenantIdHint =
      data.tenantId == null || data.tenantId === ''
        ? null
        : String(data.tenantId).trim().slice(0, 120) || null;

    const entrySource = parseOptionalInterviewEntrySource(data.entry);

    const db = admin.firestore();
    const userRef = db.collection('users').doc(auth.uid);
    const freshUserSnap = await userRef.get();
    const enrichedUd = mergeEnrichedUserDocForPrescreenSubmit(
      (freshUserSnap.data() || {}) as Record<string, unknown>,
      sessionProfileEnhancements,
    );

    let interviewContext: AiInterviewContext | null = null;
    if (applicationId) {
      interviewContext = await buildAiInterviewContext(db, {
        userId: auth.uid,
        applicationId,
        tenantId: tenantIdHint,
        userDoc: enrichedUd,
      });
    }

    const pe = interviewContext?.businessRules?.aiPrescreen;
    const eligibility = evaluateAiPrescreenEligibility(enrichedUd, {
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
      sessionProfileOverlay: Boolean(sessionProfileEnhancements),
    });

    let dynamicSteps: ReturnType<typeof buildDynamicPrescreenSteps> = [];
    let dynamicAnswers: Record<string, string> = {};
    let dynamicStepIds = new Set<string>();
    if (interviewContext) {
      dynamicSteps = buildDynamicPrescreenSteps(interviewContext);
      dynamicStepIds = new Set(dynamicSteps.map((s) => s.id));
      dynamicAnswers = parseDynamicAnswers(data.dynamicAnswers, dynamicStepIds);
      const deduped = applyPrescreenDynamicDedupe(dynamicSteps, answers, dynamicAnswers);
      dynamicAnswers = deduped.mergedDynamicAnswers;
      if (deduped.skipped.length > 0) {
        logger.info('submitWorkerAiPrescreenInterview.dynamic_dedupe', {
          userId: auth.uid,
          applicationId,
          skipped: deduped.skipped,
        });
      }
    }

    validateComplianceDisclosureFollowUps(answers, dynamicStepIds);

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
      userDoc: enrichedUd,
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
      categoryScores,
      categoryEvidence,
      categoryConfidence,
    } = bundle;

    const assignmentReadiness = aiBlockCore.assignmentReadiness as { status?: string };
    const confidenceScore = aiBlockCore.confidenceScore as number;

    logger.info('worker_ai_prescreen.scored', {
      userId: auth.uid,
      interviewKind: 'worker_ai_prescreen',
      applicationId,
      entry: entrySource ?? null,
      overallScore: scored.overallScore,
      recommendation: scored.recommendation,
      flags: aiFlags,
      confidenceScore,
      assignmentReadiness: assignmentReadiness?.status,
      gigEligible: (aiBlockCore.alternatePaths as { gigEligible?: boolean })?.gigEligible === true,
    });
    const fn = String(enrichedUd.firstName || '').trim();
    const ln = String(enrichedUd.lastName || '').trim();
    const createdByName = fn || ln ? `${fn} ${ln}`.trim() : 'Worker';

    try {
      const openingPatch = buildPrescreenOpeningProfilePatch(answers);
      await userRef.set(
        {
          ...openingPatch,
          interviewStatus: 'completed',
          hasWorkerAiPrescreenInterview: true,
          lastInterviewCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
          'workerProfile.preferences.prescreenOpeningCapturedAt': admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (eOpen) {
      logger.warn('submitWorkerAiPrescreenInterview.opening_profile_write_failed', {
        userId: auth.uid,
        message: eOpen instanceof Error ? eOpen.message : String(eOpen),
      });
    }

    const questions = [
      ...[...REQUIRED_KEYS, ...OPTIONAL_CORE_STORED_KEYS].filter(
        (id) => !shouldOmitCoreQuestionFromStoredInterview(id, answers, dynamicStepIds),
      ).map((id) => ({
        id,
        question: WORKER_AI_PRESCREEN_PROMPTS[id] || id,
        answer: formatAnswerForStorage(id, answers),
        type: questionTypeForKey(id),
      })),
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
      ...(entrySource ? { entry: entrySource } : {}),
      assignmentId: null,
      companyId: null,
      questions,
      notes: '',
      score10,
      isArchived: false,
      ai: aiBlock,
    };

    await interviewRef.set(interviewPayload);

    try {
      await userRef.set(
        {
          hasWorkerAiPrescreenInterview: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (eFlag) {
      logger.warn('submitWorkerAiPrescreenInterview.has_prescreen_flag_write_failed', {
        userId: auth.uid,
        message: eFlag instanceof Error ? eFlag.message : String(eFlag),
      });
    }

    try {
      await maybeEmitInterviewCompletedCategoryScores(db, { uid: auth.uid, interviewId });
    } catch (e) {
      logger.warn('submitWorkerAiPrescreenInterview.activity_category_score_failed', {
        userId: auth.uid,
        interviewId,
        message: e instanceof Error ? e.message : String(e),
      });
    }

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
              categoryScores,
              categoryEvidence,
              categoryConfidence,
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
