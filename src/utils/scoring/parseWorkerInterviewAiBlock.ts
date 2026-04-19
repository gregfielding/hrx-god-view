/**
 * Parse `users/{uid}/interviews/{id}.ai` into WorkerInterviewAiBlock (shared by Interview tab + profile header).
 */

import type { WorkerInterviewAiBlock } from '../../types/workerAiPrescreenInterview';
import { parsePrescreenCategoryScoresFromFirestore } from '../parseRecruiterCategoryScores';

export function parseWorkerInterviewAiBlock(raw: unknown): WorkerInterviewAiBlock | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const overallScore = typeof o.overallScore === 'number' ? o.overallScore : NaN;
  if (!Number.isFinite(overallScore)) return undefined;
  const rec = o.recommendation;
  const recommendation =
    rec === 'proceed' || rec === 'review' || rec === 'caution' || rec === 'decline' ? rec : 'review';
  const flags = Array.isArray(o.flags) ? o.flags.map((x) => String(x)) : [];
  let subScores: WorkerInterviewAiBlock['subScores'];
  const sub = o.subScores;
  if (sub && typeof sub === 'object') {
    const s = sub as Record<string, unknown>;
    subScores = {
      experience: typeof s.experience === 'number' ? s.experience : undefined,
      reliability: typeof s.reliability === 'number' ? s.reliability : undefined,
      transportation: typeof s.transportation === 'number' ? s.transportation : undefined,
      risk: typeof s.risk === 'number' ? s.risk : undefined,
      physical: typeof s.physical === 'number' ? s.physical : undefined,
      fit: typeof s.fit === 'number' ? s.fit : undefined,
      compliance: typeof s.compliance === 'number' ? s.compliance : undefined,
    };
  }
  const summary = typeof o.summary === 'string' ? o.summary : undefined;
  const model = typeof o.model === 'string' ? o.model : undefined;
  const ct = o.computedAt as { toDate?: () => Date } | undefined;
  const computedAt = ct && typeof ct.toDate === 'function' ? ct.toDate() : undefined;

  let assignmentReadiness: WorkerInterviewAiBlock['assignmentReadiness'];
  const ar = o.assignmentReadiness;
  if (ar && typeof ar === 'object') {
    const s = (ar as Record<string, unknown>).status;
    const status = s === 'ready' || s === 'review' || s === 'blocked' ? s : 'review';
    const reasons = Array.isArray((ar as Record<string, unknown>).reasons)
      ? ((ar as Record<string, unknown>).reasons as unknown[]).map((x) => String(x))
      : [];
    assignmentReadiness = { status, reasons };
  }

  let alternatePaths: WorkerInterviewAiBlock['alternatePaths'];
  const ap = o.alternatePaths;
  if (ap && typeof ap === 'object' && (ap as Record<string, unknown>).gigEligible === true) {
    alternatePaths = { gigEligible: true };
  }

  let aiInterviewContext: Record<string, unknown> | undefined;
  const ctx = o.aiInterviewContext;
  if (ctx && typeof ctx === 'object' && !Array.isArray(ctx)) {
    aiInterviewContext = ctx as Record<string, unknown>;
  }

  let hiringDecision: WorkerInterviewAiBlock['hiringDecision'];
  const hdRaw = o.hiringDecision;
  if (hdRaw && typeof hdRaw === 'object') {
    const hd = hdRaw as Record<string, unknown>;
    const dec = hd.decision;
    if (dec === 'advance' || dec === 'review' || dec === 'hold' || dec === 'reject') {
      hiringDecision = {
        decision: dec,
        eligibleForAutoAdvance: Boolean(hd.eligibleForAutoAdvance),
        reasonCodes: Array.isArray(hd.reasonCodes) ? hd.reasonCodes.map((x) => String(x)) : [],
      };
    }
  }

  const parsedCats = parsePrescreenCategoryScoresFromFirestore(o);

  const baseInterviewScore = typeof o.baseInterviewScore === 'number' ? o.baseInterviewScore : undefined;
  const overrideAdjustedScore = typeof o.overrideAdjustedScore === 'number' ? o.overrideAdjustedScore : undefined;
  const overrideScoreDelta = typeof o.overrideScoreDelta === 'number' ? o.overrideScoreDelta : undefined;
  const overrideRulesVersion = typeof o.overrideRulesVersion === 'string' ? o.overrideRulesVersion : undefined;
  const recruiterTrustLevel =
    o.recruiterTrustLevel === 'high' || o.recruiterTrustLevel === 'medium' || o.recruiterTrustLevel === 'low'
      ? o.recruiterTrustLevel
      : undefined;
  const softBlocks = Array.isArray(o.softBlocks) ? o.softBlocks.map((x) => String(x)) : undefined;
  const hardBlocks = Array.isArray(o.hardBlocks) ? o.hardBlocks.map((x) => String(x)) : undefined;

  const scoreAdjustmentReasons = Array.isArray(o.scoreAdjustmentReasons)
    ? o.scoreAdjustmentReasons.map((x) => String(x).trim()).filter(Boolean)
    : undefined;
  const decisionAdjustmentReasons = Array.isArray(o.decisionAdjustmentReasons)
    ? o.decisionAdjustmentReasons.map((x) => String(x).trim()).filter(Boolean)
    : undefined;

  return {
    overallScore,
    baseInterviewScore,
    overrideAdjustedScore,
    overrideScoreDelta,
    overrideRulesVersion,
    recruiterTrustLevel,
    softBlocks,
    hardBlocks,
    recommendation,
    flags,
    subScores,
    summary,
    model,
    computedAt,
    assignmentReadiness,
    alternatePaths,
    aiInterviewContext,
    hiringDecision,
    categoryScores: parsedCats.scores ?? undefined,
    categoryEvidence: parsedCats.evidence ?? undefined,
    scoreAdjustmentReasons,
    decisionAdjustmentReasons,
  };
}
