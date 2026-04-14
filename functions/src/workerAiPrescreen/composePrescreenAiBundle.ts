/**
 * Shared scoring / enrichment / hiring decision bundle for worker AI prescreen.
 * Used by submitWorkerAiPrescreenInterview and backfill scripts.
 */
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import {
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
  shouldFlagRiskAdmission,
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
import { mergeDynamicDrugBackgroundIntoCoreAnswers } from './prescreenAnswerMerge';

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
  const scored = scoreWorkerAiPrescreen(answersEffective, {
    answerQualityFlags: answerQualityEval.flags,
    scoreAdjustment: answerQualityEval.scoreAdjustment,
  });
  const riskProfile = computeRiskProfile(answersEffective);
  const riskAdmission = shouldFlagRiskAdmission(answersEffective);
  const aiFlags = [...new Set([...scored.flags, ...(riskAdmission ? ['risk_admission_detected'] : [])])];
  const confidenceScore = computeConfidenceScore({
    overallScore: scored.overallScore,
    answerQuality: answerQualityEval.answerQuality,
    riskProfile,
    flags: aiFlags,
  });
  const score10 = Math.max(0, Math.min(10, Math.round(scored.overallScore / 10)));

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

  const aiBlockCore: Record<string, unknown> = {
    overallScore: scored.overallScore,
    recommendation: scored.recommendation,
    flags: aiFlags,
    answerQuality: answerQualityEval.answerQuality,
    confidenceScore,
    riskProfile,
    subScores: scored.subScores,
    summary: scored.summary,
    assignmentReadiness,
    alternatePaths,
    debug: complianceDebug,
  };

  if (interviewContext) {
    aiBlockCore.aiInterviewContext = JSON.parse(JSON.stringify(interviewContext)) as Record<string, unknown>;
  }

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

  const hiringResult = evaluateAiHiringDecision({
    interviewResult: {
      overallScore: scored.overallScore,
      score10,
      flags: aiFlags,
      recommendation: scored.recommendation,
      dynamicAnswers: dynamicAnswers as Record<string, DynamicAnswerValue>,
    },
    hiringPolicy: hiringPolicyInput,
    application: applicationCtx,
  });

  aiBlockCore.hiringDecision = {
    decision: hiringResult.decision,
    eligibleForAutoAdvance: hiringResult.eligibleForAutoAdvance,
    reasonCodes: hiringResult.reasonCodes,
  };

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
      const orch = runAiHiringOrchestratorV1({
        interviewResult: {
          overallScore: scored.overallScore,
          score10,
          flags: aiFlags,
          recommendation: scored.recommendation,
          dynamicAnswers: dynamicAnswers as Record<string, DynamicAnswerValue>,
        },
        resolvedPolicy: hp.resolvedAiHiring,
        application: applicationCtx,
        containerStats,
        jobFitScore: extractJobFitScore(applicationFieldsForRisk),
        applicationNoShowBand: applicationNoShowRisk.band,
        assignmentNoShowBand: assignNs.band,
        assignmentIdUsed: assignNs.assignmentId,
      });
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
        finalResult: orch.finalResult,
        finalEligibleForAutoAdvance: orch.finalEligibleForAutoAdvance,
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
  };
}
