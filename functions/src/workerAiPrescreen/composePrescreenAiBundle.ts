/**
 * Shared scoring / enrichment / hiring decision bundle for worker AI prescreen.
 * Used by submitWorkerAiPrescreenInterview and backfill scripts.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
  buildRecruiterSummaryLine,
  prescreenLetterGrade,
  scoreWorkerAiPrescreen,
  type AiPrescreenScoreResult,
  type WorkerAiPrescreenAnswers,
} from './scoreWorkerAiPrescreen';
import { evaluatePrescreenAnswerQuality } from './prescreenTextAnswerQuality';
import { buildDynamicPrescreenSteps } from './buildDynamicPrescreenQuestions';
import { computePrescreenAssignmentReadiness } from './prescreenAssignmentReadiness';
import { evaluateAiHiringDecision, type DynamicAnswerValue, type HiringDecision } from './evaluateAiHiringDecision';
import { DEFAULT_RESOLVED_AI_HIRING, toAiHiringPolicyDecisionInput } from './aiHiringPolicyResolution';
import type { AiInterviewContext } from './aiInterviewContextTypes';
import {
  buildPrescreenComplianceDebug,
  computeConfidenceScore,
  computeRiskProfile,
} from './interviewAiEnrichment';
import { computeApplicationNoShowRisk } from '../readiness/noShowRiskShared';
import { stripUndefinedDeep } from '../utils/stripUndefinedDeep';
import {
  extractJobFitScore,
  loadHiringContainerStats,
  loadScopedAssignmentNoShowBand,
  persistAiHiringStatsSnapshot,
} from './hiringContainerStats';
import { runAiHiringOrchestratorV1 } from './runAiHiringOrchestratorV1';
import { computeRecruiterMasterScore } from '../shared/recruiterMasterScore';
import { mergeDynamicDrugBackgroundIntoCoreAnswers } from './prescreenAnswerMerge';
import {
  applyRecruiterOperationalOverrides,
  mergeOperationalBlocksIntoHiringResult,
} from './applyRecruiterOperationalOverrides';
import { buildPrescreenAdjustmentCopy } from './recruiterAdjustmentCopy';
import type { OperationalOverrideResult } from './operationalOverrideTypes';
import { computePrescreenReviewTriage } from './prescreenReviewTriage';
import {
  computePrescreenCategoryScores,
  type PrescreenCategoryEvidenceV1,
  type PrescreenCategoryConfidenceV1,
  type PrescreenCategoryScoresV1,
} from './prescreenCategoryScores';

function certificationsMetaFromUserDoc(ud: Record<string, unknown>): { count: number; loaded: boolean } {
  const skills = ud.skillsData;
  if (!skills || typeof skills !== 'object') return { count: 0, loaded: false };
  const c = (skills as Record<string, unknown>).certifications;
  if (!Array.isArray(c)) return { count: 0, loaded: true };
  return { count: c.length, loaded: true };
}

export function priorityBucketForDecision(d: HiringDecision): string {
  switch (d) {
    case 'advance':
      return 'top_candidate';
    case 'review':
      return 'review_queue';
    case 'hold':
      return 'hold_pool';
    case 'reject':
      return 'reject';
    default:
      return 'review_queue';
  }
}

export function recommendedActionsPhase1(args: {
  decision: HiringDecision;
  gigPathEligible: boolean;
}): string[] {
  const { decision, gigPathEligible } = args;
  if (decision === 'advance') return ['recommend_onboarding_review'];
  if (decision === 'review') return ['recommend_recruiter_review'];
  if (decision === 'hold') {
    const out = ['recommend_hold_for_alternate_role'];
    if (gigPathEligible) out.push('recommend_gig_path_review');
    return out;
  }
  if (decision === 'reject') return ['recommend_recruiter_review'];
  return [];
}

export type ComposedPrescreenAiBundle = {
  scored: AiPrescreenScoreResult;
  aiBlockCore: Record<string, unknown>;
  hiringResult: ReturnType<typeof evaluateAiHiringDecision>;
  applicationNoShowRisk: ReturnType<typeof computeApplicationNoShowRisk>;
  orchestratorV1Firestore: Record<string, unknown> | null;
  priorityBucket: string;
  recommendedActions: string[];
  gigPathEligible: boolean;
  aiFlags: string[];
  score10: number;
  categoryScores: PrescreenCategoryScoresV1;
  categoryEvidence: PrescreenCategoryEvidenceV1;
  categoryConfidence: PrescreenCategoryConfidenceV1;
  operationalOverride: OperationalOverrideResult;
};

/**
 * Computes `ai` map fields (without `computedAt` / `model` unless caller sets) plus automation outputs.
 */
export async function composePrescreenAiBundle(args: {
  db: Firestore;
  userId: string;
  answers: WorkerAiPrescreenAnswers;
  dynamicAnswers: Record<string, string>;
  interviewContext: AiInterviewContext | null;
  applicationId: string | null;
  tenantIdHint: string | null;
  interviewId: string;
  userDoc: Record<string, unknown>;
}): Promise<ComposedPrescreenAiBundle> {
  const { db, answers, dynamicAnswers, interviewContext, applicationId, tenantIdHint, interviewId, userDoc } = args;

  const { merged: answersEffective, meta: drugBackgroundMergeMeta } =
    mergeDynamicDrugBackgroundIntoCoreAnswers(answers, dynamicAnswers);

  const answerQualityEval = evaluatePrescreenAnswerQuality(answersEffective);
  const riskProfile = computeRiskProfile(answersEffective, drugBackgroundMergeMeta);
  /** Only attendance admissions carry the extra `risk_admission_detected` penalty — drug/bg use severity tiers. */
  const attendanceAdmission = String(answersEffective.attendance_issues ?? '')
    .trim()
    .toLowerCase() === 'yes';
  const scored = scoreWorkerAiPrescreen(answersEffective, {
    answerQualityFlags: answerQualityEval.flags,
    scoreAdjustment: answerQualityEval.scoreAdjustment,
    drugBackgroundMergeMeta: drugBackgroundMergeMeta,
    extraPenaltyFlags: attendanceAdmission ? ['risk_admission_detected'] : [],
  });
  const aiFlags = [...new Set([...scored.flags])];

  let dynamicSteps: ReturnType<typeof buildDynamicPrescreenSteps> = [];
  if (interviewContext) {
    dynamicSteps = buildDynamicPrescreenSteps(interviewContext);
  }

  const { assignmentReadiness, alternatePaths } = computePrescreenAssignmentReadiness({
    context: interviewContext,
    dynamicSteps,
    dynamicAnswers,
    coreScore: scored,
  });

  const complianceDebug = buildPrescreenComplianceDebug({
    answersEffective,
    mergeMeta: drugBackgroundMergeMeta,
    flags: aiFlags,
    complianceRisk: riskProfile.complianceRisk,
  });

  const { categoryScores, categoryEvidence, categoryConfidence } = computePrescreenCategoryScores({
    answers: answersEffective,
    scored,
    dynamicAnswers,
  });

  const certMeta = certificationsMetaFromUserDoc(userDoc);
  const operationalOverride = applyRecruiterOperationalOverrides({
    baseInterviewScore: scored.overallScore,
    flags: aiFlags,
    subScores: scored.subScores,
    answers: answersEffective,
    dynamicAnswers,
    categoryScores,
    assignmentReadiness,
    userDoc,
    scoreSummary: userDoc.scoreSummary as Record<string, unknown> | undefined,
    certificationsCount: certMeta.count,
    certificationsLoaded: certMeta.loaded,
  });

  const adjustedScore = operationalOverride.adjustedScore;
  const score10 = Math.max(0, Math.min(10, Math.round(adjustedScore / 10)));

  if (adjustedScore >= 80 && operationalOverride.recommendedRecommendation === 'decline') {
    logger.warn('composePrescreenAiBundle.qa_high_score_with_decline', {
      userId: args.userId,
      interviewId: args.interviewId,
      applicationId: args.applicationId,
      overallScore: adjustedScore,
      baseInterviewScore: scored.overallScore,
      flags: scored.flags,
    });
  }

  const confidenceScore = computeConfidenceScore({
    overallScore: adjustedScore,
    answerQuality: answerQualityEval.answerQuality,
    riskProfile,
    flags: aiFlags,
  });

  const reviewTriageAdjusted =
    operationalOverride.recommendedRecommendation === 'review'
      ? computePrescreenReviewTriage({
          overallScore: adjustedScore,
          flags: aiFlags,
          reviewKind: operationalOverride.prescreenReviewKind,
          riskSummary: scored.riskSummary,
        })
      : null;

  const summaryAdjusted =
    operationalOverride.recommendedRecommendation === 'review' && reviewTriageAdjusted?.summaryShort
      ? reviewTriageAdjusted.summaryShort
      : buildRecruiterSummaryLine(
          adjustedScore,
          operationalOverride.recommendedRecommendation,
          aiFlags,
          operationalOverride.prescreenReviewKind,
        );

  const hiringPolicyInput = interviewContext?.hiringPolicy
    ? toAiHiringPolicyDecisionInput(interviewContext.hiringPolicy.resolvedAiHiring)
    : toAiHiringPolicyDecisionInput(DEFAULT_RESOLVED_AI_HIRING);

  const applicationCtx: {
    applicationId: string;
    jobId?: string;
    jobOrderId?: string;
    groupId?: string;
  } = {
    applicationId: applicationId || '__no_application__',
  };
  const postingIdForApp =
    interviewContext?.sources?.jobPostingId != null && String(interviewContext.sources.jobPostingId).trim() !== ''
      ? String(interviewContext.sources.jobPostingId).trim()
      : interviewContext?.assignment?.jobId
        ? String(interviewContext.assignment.jobId)
        : null;
  if (postingIdForApp) {
    applicationCtx.jobId = postingIdForApp;
  }
  if (interviewContext?.sources?.jobOrderId) {
    applicationCtx.jobOrderId = String(interviewContext.sources.jobOrderId);
  }
  if (interviewContext?.hiringPolicy?.container.kind === 'group') {
    applicationCtx.groupId = interviewContext.hiringPolicy.container.groupId;
  }

  /** Trust promote already applied inside operational overrides — do not double-apply in hiring engine. */
  const operationalTrustForEngine = { promoteDeclineToReview: false };

  const hiringResultRaw = evaluateAiHiringDecision({
    interviewResult: {
      overallScore: adjustedScore,
      score10,
      flags: aiFlags,
      recommendation: operationalOverride.recommendedRecommendation,
      dynamicAnswers: dynamicAnswers as Record<string, DynamicAnswerValue>,
    },
    hiringPolicy: hiringPolicyInput,
    application: applicationCtx,
    operationalTrust: operationalTrustForEngine,
  });

  const hiringResult = mergeOperationalBlocksIntoHiringResult(
    hiringResultRaw,
    operationalOverride.softBlocks,
    operationalOverride.hardBlocks,
  );

  const adjustmentCopy = buildPrescreenAdjustmentCopy({
    scored,
    operationalOverride,
    hiringResult,
  });

  const aiBlockCore: Record<string, unknown> = {
    overallScore: scored.overallScore,
    baseInterviewScore: scored.overallScore,
    overrideAdjustedScore: operationalOverride.adjustedScore,
    overrideScoreDelta: operationalOverride.scoreDelta,
    overrideBand: operationalOverride.finalBand,
    overrideRulesVersion: operationalOverride.rulesVersion,
    overridesApplied: operationalOverride.overridesApplied,
    overrideInputSignature: operationalOverride.overrideInputSignature,
    recruiterTrustLevel: operationalOverride.recruiterTrustLevel,
    softBlocks: operationalOverride.softBlocks,
    hardBlocks: operationalOverride.hardBlocks,
    letterGrade: prescreenLetterGrade(adjustedScore),
    recommendation: operationalOverride.recommendedRecommendation,
    reviewKind: operationalOverride.prescreenReviewKind ?? null,
    reviewTriage: reviewTriageAdjusted,
    reviewLane: reviewTriageAdjusted?.lane ?? null,
    reviewSubtype: reviewTriageAdjusted?.subtype ?? null,
    reviewReasons: reviewTriageAdjusted?.reasons ?? [],
    reviewSummaryShort: reviewTriageAdjusted?.summaryShort ?? null,
    flags: aiFlags,
    answerQuality: answerQualityEval.answerQuality,
    confidenceScore,
    riskProfile,
    subScores: scored.subScores,
    scoreBreakdown: scored.scoreBreakdown,
    riskSummary: scored.riskSummary ?? null,
    summary: summaryAdjusted,
    assignmentReadiness,
    alternatePaths,
    debug: complianceDebug,
    categoryScores,
    categoryEvidence,
    categoryConfidence,
    scoreAdjustmentReasons: adjustmentCopy.scoreAdjustmentReasons,
    decisionAdjustmentReasons: adjustmentCopy.decisionAdjustmentReasons,
    prescreenOpeningPreferences: {
      targetWorkTypes: answers.opening_target_work_types ?? [],
      schedulePreferences: answers.opening_schedule_preferences ?? [],
      experienceIndustrial: answers.opening_experience_industrial ?? [],
      experienceHospitality: answers.opening_experience_hospitality ?? [],
      experienceEvents: answers.opening_experience_events ?? [],
      experienceClerical: answers.opening_experience_clerical ?? [],
      experienceHealthcare: answers.opening_experience_healthcare ?? [],
      gigWorkInterestCategories: answers.opening_gig_types ?? [],
    },
  };

  if (interviewContext) {
    aiBlockCore.aiInterviewContext = JSON.parse(JSON.stringify(interviewContext)) as Record<string, unknown>;
  }

  aiBlockCore.hiringDecision = {
    decision: hiringResult.decision,
    eligibleForAutoAdvance: hiringResult.eligibleForAutoAdvance,
    reasonCodes: hiringResult.reasonCodes,
  };

  aiBlockCore.scoreComputationVersion = 'prescreen_ops_override_v1';

  const priorityBucket = priorityBucketForDecision(hiringResult.decision);
  const gigPathEligible = hiringResult.reasonCodes.includes('gig_path_eligible');
  const recommendedActions = recommendedActionsPhase1({
    decision: hiringResult.decision,
    gigPathEligible,
  });

  const tenantIdForApp = interviewContext?.businessRules?.tenant ?? tenantIdHint ?? null;

  let applicationFieldsForRisk: Record<string, unknown> = {};
  if (applicationId && tenantIdForApp) {
    try {
      const appSnap = await db.doc(`tenants/${tenantIdForApp}/applications/${applicationId}`).get();
      if (appSnap.exists) applicationFieldsForRisk = (appSnap.data() || {}) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  const scoreSummary = userDoc.scoreSummary as Record<string, unknown> | undefined;
  const completenessForRisk =
    scoreSummary && typeof scoreSummary.completenessScore === 'number' ? scoreSummary.completenessScore : null;
  const applicationNoShowRisk = computeApplicationNoShowRisk({
    riskProfile,
    flags: aiFlags,
    applicationFields: applicationFieldsForRisk,
    completenessScore: completenessForRisk,
  });

  let orchestratorV1Firestore: Record<string, unknown> | null = null;
  if (applicationId && tenantIdForApp && interviewContext?.hiringPolicy) {
    try {
      const hp = interviewContext.hiringPolicy;
      const [containerStats, assignNs] = await Promise.all([
        loadHiringContainerStats(db, tenantIdForApp, hp.container, {
          workerAiPrescreenRequired: hp.resolvedInterview.workerAiPrescreenRequired,
        }),
        loadScopedAssignmentNoShowBand(db, tenantIdForApp, applicationId, applicationCtx.jobOrderId),
      ]);
      try {
        await persistAiHiringStatsSnapshot(db, tenantIdForApp, hp.container, containerStats);
      } catch {
        /* non-fatal */
      }
      // Group-scoped: gate on Master Recruiter Score (50% category + 35% interview + 15% profile)
      // using the just-computed prescreen as the interview component. For job-order containers,
      // keep legacy semantics (gate on prescreen overall).
      let groupGateScoreOverride: number | null = null;
      if (hp.container.kind === 'group') {
        try {
          const prescreenAiForMaster: Record<string, unknown> = {
            overrideAdjustedScore: adjustedScore,
            overallScore: adjustedScore,
            baseInterviewScore: scored.overallScore,
            recommendation: operationalOverride.recommendedRecommendation,
            flags: aiFlags,
          };
          const tp = answersEffective.transportation_plan;
          const master = computeRecruiterMasterScore({
            userData: userDoc,
            prescreenAi: prescreenAiForMaster,
            prescreenTransportationPlan: typeof tp === 'string' ? tp : null,
          });
          if (typeof master.score100 === 'number' && Number.isFinite(master.score100)) {
            groupGateScoreOverride = master.score100;
          }
        } catch {
          // Non-fatal — orchestrator falls back to prescreen overall.
        }
      }

      const orch = runAiHiringOrchestratorV1({
        interviewResult: {
          overallScore: adjustedScore,
          score10,
          flags: aiFlags,
          recommendation: operationalOverride.recommendedRecommendation,
          dynamicAnswers: dynamicAnswers as Record<string, DynamicAnswerValue>,
        },
        resolvedPolicy: hp.resolvedAiHiring,
        application: applicationCtx,
        containerStats,
        jobFitScore: extractJobFitScore(applicationFieldsForRisk),
        applicationNoShowBand: applicationNoShowRisk.band,
        assignmentNoShowBand: assignNs.band,
        assignmentIdUsed: assignNs.assignmentId,
        operationalTrust: operationalTrustForEngine,
        gateScoreOverride: groupGateScoreOverride,
        gateScoreSource: groupGateScoreOverride != null ? 'master_recruiter' : 'prescreen_overall',
      });
      const orchFinalMerged = mergeOperationalBlocksIntoHiringResult(
        orch.finalResult,
        operationalOverride.softBlocks,
        operationalOverride.hardBlocks,
      );
      orchestratorV1Firestore = stripUndefinedDeep({
        version: orch.version,
        evaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
        sourceInterviewId: interviewId,
        context: orch.context,
        policy: orch.policy,
        inputs: orch.inputs,
        steps: orch.steps,
        policyEngineResult: orch.policyEngineResult,
        afterNoShowOverlay: orch.afterNoShowOverlay,
        finalResult: orchFinalMerged,
        finalEligibleForAutoAdvance: orchFinalMerged.eligibleForAutoAdvance,
      });
    } catch (e) {
      logger.warn('composePrescreenAiBundle.orchestratorV1_failed', {
        userId: args.userId,
        applicationId,
        tenantId: tenantIdForApp,
        message: e instanceof Error ? e.message : String(e),
      });
      orchestratorV1Firestore = null;
    }
  }

  return {
    scored,
    aiBlockCore,
    hiringResult,
    applicationNoShowRisk,
    orchestratorV1Firestore,
    priorityBucket,
    recommendedActions,
    gigPathEligible,
    aiFlags,
    score10,
    categoryScores,
    categoryEvidence,
    categoryConfidence,
    operationalOverride,
  };
}
