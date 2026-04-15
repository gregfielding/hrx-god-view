/**
 * Re-run `runAiHiringOrchestratorV1` against **current** resolved hiring policy (tenant + group `hiringConfig`
 * merged in `resolveAiHiringPolicyBundle`) while reusing **stored** prescreen outputs (score, flags, interview doc).
 * Used by Hire Passed / preview so changing D. Quality / E. Targets affects eligibility without rewriting Firestore.
 */
import * as admin from 'firebase-admin';
import type { ApplicationContextInput, DynamicAnswerValue, InterviewResultInput } from '../workerAiPrescreen/evaluateAiHiringDecision';
import { resolveAiHiringPolicyBundleForUserGroupTool } from '../workerAiPrescreen/aiHiringPolicyResolution';
import { runAiHiringOrchestratorV1 } from '../workerAiPrescreen/runAiHiringOrchestratorV1';
import {
  extractJobFitScore,
  loadHiringContainerStats,
  loadScopedAssignmentNoShowBand,
} from '../workerAiPrescreen/hiringContainerStats';
import { extractPrescreenAnswersFromInterviewDoc } from '../workerAiPrescreen/extractPrescreenAnswersFromInterviewDoc';

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

function syntheticPostingFromApplication(app: Record<string, unknown>): Record<string, unknown> {
  const loc = norm(app.location);
  return {
    jobTitle: norm(app.jobTitle) || norm(app.positionTitle),
    postTitle: norm(app.jobTitle) || norm(app.postTitle),
    companyName: norm(app.companyName),
    worksiteName: loc || undefined,
    location: loc || undefined,
    jobOrderId: app.jobOrderId,
  };
}

function mapDynToValue(dyn: Record<string, string>): Record<string, DynamicAnswerValue> {
  const out: Record<string, DynamicAnswerValue> = {};
  for (const [k, v] of Object.entries(dyn)) {
    const t = v.toLowerCase();
    if (t === 'yes' || t === 'y') out[k] = 'yes';
    else if (t === 'no' || t === 'n') out[k] = 'no';
    else out[k] = 'not_sure';
  }
  return out;
}

type AiInterviewRecommendation = 'proceed' | 'review' | 'decline';

async function buildInterviewResultInput(
  db: admin.firestore.Firestore,
  userId: string,
  data: Record<string, unknown>,
): Promise<InterviewResultInput | null> {
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  if (!aa || typeof aa !== 'object') return null;
  const score = typeof aa.score === 'number' && Number.isFinite(aa.score) ? aa.score : null;
  if (score == null) return null;

  const sourceId = typeof aa.sourceInterviewId === 'string' ? aa.sourceInterviewId.trim() : '';
  let flags: string[] = [];
  let recommendation: AiInterviewRecommendation = 'proceed';
  let dynamicAnswers: Record<string, DynamicAnswerValue> | undefined;

  if (sourceId) {
    const snap = await db.doc(`users/${userId}/interviews/${sourceId}`).get();
    if (snap.exists) {
      const idata = snap.data() as Record<string, unknown>;
      const ai = idata.ai as Record<string, unknown> | undefined;
      if (Array.isArray(ai?.flags)) flags = ai!.flags as string[];
      const rec = ai?.recommendation;
      if (rec === 'decline' || rec === 'review' || rec === 'proceed') recommendation = rec;
      const { dynamicAnswers: dynRaw } = extractPrescreenAnswersFromInterviewDoc(idata);
      if (Object.keys(dynRaw).length) dynamicAnswers = mapDynToValue(dynRaw);
    }
  }

  const score10 = Math.max(0, Math.min(10, Math.round(score / 10)));
  return {
    overallScore: score,
    score10,
    flags,
    recommendation,
    dynamicAnswers,
  };
}

/**
 * Returns orchestrator **final** decision using **today’s** merged policy + stored interview signals.
 */
export async function evaluateCurrentPolicyOrchestratorDecision(
  db: admin.firestore.Firestore,
  tenantId: string,
  tenantData: Record<string, unknown>,
  applicationId: string,
  data: Record<string, unknown>,
  userGroupId: string,
): Promise<{ decision: string | null; reason?: string }> {
  const userId = String(data.userId || data.candidateId || '').trim();
  if (!userId) return { decision: null, reason: 'missing_user' };

  const jobPostingId = norm(data.jobId) || norm(data.job_id);
  let postingData: Record<string, unknown> = {};
  if (jobPostingId) {
    const pSnap = await db.doc(`tenants/${tenantId}/job_postings/${jobPostingId}`).get();
    postingData = pSnap.exists ? (pSnap.data() as Record<string, unknown>) : syntheticPostingFromApplication(data);
  } else {
    postingData = syntheticPostingFromApplication(data);
  }

  const bundle = await resolveAiHiringPolicyBundleForUserGroupTool(
    db,
    tenantId,
    tenantData,
    postingData,
    userGroupId,
  );
  const interviewResult = await buildInterviewResultInput(db, userId, data);
  if (!interviewResult) return { decision: null, reason: 'missing_aiAutomation.score_or_interview' };

  const applicationCtx: ApplicationContextInput = {
    applicationId,
    jobId: jobPostingId || undefined,
    jobOrderId: norm(data.jobOrderId) || undefined,
    groupId: userGroupId,
  };

  const [containerStats, assignNs] = await Promise.all([
    loadHiringContainerStats(db, tenantId, bundle.container, {
      workerAiPrescreenRequired: bundle.resolvedInterview.workerAiPrescreenRequired,
    }),
    loadScopedAssignmentNoShowBand(db, tenantId, applicationId, norm(data.jobOrderId) || undefined),
  ]);

  const jobFit = extractJobFitScore(data);

  let applicationNoShowBand: string | null | undefined;
  let assignmentNoShowBand: string | null | undefined;
  const aa = data.aiAutomation as Record<string, unknown> | undefined;
  const v1 = aa?.orchestratorV1 as Record<string, unknown> | undefined;
  const inputs = v1?.inputs as Record<string, unknown> | undefined;
  if (inputs && typeof inputs.applicationNoShowBand === 'string') {
    applicationNoShowBand = inputs.applicationNoShowBand;
    assignmentNoShowBand =
      typeof inputs.assignmentNoShowBand === 'string' ? inputs.assignmentNoShowBand : null;
  }

  const orch = runAiHiringOrchestratorV1({
    interviewResult,
    resolvedPolicy: bundle.resolvedAiHiring,
    application: applicationCtx,
    containerStats,
    jobFitScore: jobFit,
    applicationNoShowBand: applicationNoShowBand ?? undefined,
    assignmentNoShowBand: assignmentNoShowBand ?? undefined,
    assignmentIdUsed: assignNs.assignmentId,
  });

  const final = orch.finalResult?.decision;
  const decision = typeof final === 'string' ? final.trim().toLowerCase() : null;
  return { decision: decision || null };
}
