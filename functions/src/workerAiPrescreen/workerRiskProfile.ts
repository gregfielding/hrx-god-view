/**
 * Structured `users/{uid}.riskProfile` — built from prescreen interview signals + compliance snapshot.
 * Co-located with score recompute / interview submit; signature-guarded writes only.
 */

import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import type { ComposedPrescreenAiBundle } from './composePrescreenAiBundle';
import type { AiPrescreenScoreResult } from './scoreWorkerAiPrescreen';
import type { PrescreenRiskSeverity, PrescreenRiskSummary } from './prescreenRiskSeverity';
import type { PrescreenReviewTriage } from './prescreenReviewTriage';
import type { PrescreenCategoryScoresV1 } from './prescreenCategoryScores';
import {
  parseCategoryScoresCurrent,
  prescreenCategoryScoresV1FromV2,
} from '../categoryScoreEvolution/prescreenCategoryScoresParse';
import { extractPrescreenAnswersFromInterviewDoc } from './extractPrescreenAnswersFromInterviewDoc';
import { mergeDynamicDrugBackgroundIntoCoreAnswers } from './prescreenAnswerMerge';
import { computeRiskProfile as computeInterviewRiskDimensions } from './interviewAiEnrichment';
import { normalizeRiskItemSummariesInDraft } from './riskSummaryNormalize';
import { buildRiskProfileStalenessPayload } from './workerRiskProfileStaleness';

export const WORKER_RISK_PROFILE_VERSION = 1;

export type WorkerRiskItemType =
  | 'attendance'
  | 'transportation'
  | 'drug'
  | 'background'
  | 'communication'
  | 'experience'
  | 'stability'
  | 'compliance'
  | 'documentation'
  | 'job_fit';

export type WorkerRiskSeverity = 'low' | 'moderate' | 'high' | 'unknown';

export type WorkerRiskItemSource =
  | 'interview'
  | 'onboarding'
  | 'system_review'
  | 'behavioral'
  | 'recruiter_note';

export type WorkerRiskItemDraft = {
  type: WorkerRiskItemType;
  severity: WorkerRiskSeverity;
  confidence: number;
  summary: string;
  source: WorkerRiskItemSource;
  sourceRef?: string | null;
  status?: 'active' | 'resolved' | 'pending';
};

export type WorkerRiskProfileDraft = {
  overallRiskScore: number;
  topRisks: WorkerRiskItemDraft[];
  lastGeneratedBy: 'interview_submit' | 'score_review' | 'system';
  version: number;
  generationSignature: string;
  /** Embedded into Firestore `riskProfile.staleness` — input observation times at compute */
  staleness?: Record<string, unknown>;
};

function normLower(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function mapPrescreenSeverityToWorker(s: PrescreenRiskSeverity): WorkerRiskSeverity {
  return s;
}

function severityWeight(s: WorkerRiskSeverity): number {
  if (s === 'high') return 4;
  if (s === 'moderate') return 3;
  if (s === 'unknown') return 2.5;
  return 2;
}

function stableStringify(obj: unknown): string {
  const sortKeys = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(sortKeys);
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      out[k] = sortKeys(o[k]);
    }
    return out;
  };
  return JSON.stringify(sortKeys(obj));
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** E-Verify case outcome from `users.eVerifyOrders` (aligned with recruiter readiness helper). */
function everifyCaseStateFromUser(ud: Record<string, unknown>): 'favorable' | 'unfavorable' | 'pending' | 'none' {
  const orders = ud.eVerifyOrders;
  if (!Array.isArray(orders) || orders.length === 0) return 'none';
  const latest = orders[orders.length - 1] as { result?: string; status?: string } | undefined;
  if (!latest) return 'none';
  const blob = `${latest.result || ''} ${latest.status || ''}`.toLowerCase();
  if (blob.includes('nonconfirmation') || blob.includes('no show') || blob.includes('referral')) return 'unfavorable';
  if (blob.includes('authorized') || blob.includes('employment authorized') || blob.includes('verified')) return 'favorable';
  if (blob.includes('tentative')) return 'pending';
  return 'pending';
}

function categoryV1FromUserDoc(ud: Record<string, unknown>): PrescreenCategoryScoresV1 | null {
  const v2 = parseCategoryScoresCurrent(ud.categoryScoresCurrent);
  if (!v2) return null;
  return prescreenCategoryScoresV1FromV2(v2);
}

type ComplianceGap = { type: WorkerRiskItemType; severity: WorkerRiskSeverity; summary: string; confidence: number };

function complianceGapsFromUser(ud: Record<string, unknown>): ComplianceGap[] {
  const out: ComplianceGap[] = [];
  const emp = normLower(ud.employeeOnboardStatus);
  if (emp && emp !== 'completed' && emp !== 'in progress') {
    out.push({
      type: 'documentation',
      severity: 'moderate',
      summary: 'Employee onboarding (I-9 / payroll path) not completed',
      confidence: 0.75,
    });
  } else if (emp === 'in progress') {
    out.push({
      type: 'documentation',
      severity: 'moderate',
      summary: 'I-9 or payroll setup still in progress',
      confidence: 0.72,
    });
  }

  const ev = everifyCaseStateFromUser(ud);
  if (ev === 'unfavorable') {
    out.push({
      type: 'compliance',
      severity: 'high',
      summary: 'E-Verify outcome unfavorable — review required',
      confidence: 0.85,
    });
  } else if (ev === 'pending') {
    out.push({
      type: 'compliance',
      severity: 'moderate',
      summary: 'E-Verify in progress — confirm before deploy',
      confidence: 0.7,
    });
  } else if (ev === 'none' && Array.isArray(ud.eVerifyOrders) && ud.eVerifyOrders.length === 0) {
    const needEv =
      normLower(ud.comfortableEVerify) === 'yes' ||
      normLower((ud.workerAttestations as { eVerifyWillingness?: string } | undefined)?.eVerifyWillingness) === 'yes';
    if (needEv) {
      out.push({
        type: 'compliance',
        severity: 'moderate',
        summary: 'E-Verify not started while participation expected',
        confidence: 0.55,
      });
    }
  }

  return out;
}

function categoryWeaknessRisks(scores: PrescreenCategoryScoresV1 | null | undefined): WorkerRiskItemDraft[] {
  if (!scores) return [];
  const items: WorkerRiskItemDraft[] = [];
  const push = (type: WorkerRiskItemType, label: string, v: number) => {
    if (v >= 52) return;
    const sev: WorkerRiskSeverity = v < 35 ? 'moderate' : 'low';
    items.push({
      type,
      severity: sev,
      confidence: 0.62,
      summary:
        v < 40
          ? `${label} category score is low (${v}) — confirm fit`
          : `${label} category score is soft (${v}) — monitor`,
      source: 'system_review',
    });
  };
  push('job_fit', 'Job readiness', scores.jobReadiness);
  push('stability', 'Stability', scores.stability);
  push('experience', 'Reliability', scores.reliability);
  return items;
}

function interviewDerivedRisks(args: {
  scored: AiPrescreenScoreResult;
  flags: string[];
  riskSummary: PrescreenRiskSummary | null | undefined;
  reviewTriage: PrescreenReviewTriage | null | undefined;
  answersEffective: import('./scoreWorkerAiPrescreen').WorkerAiPrescreenAnswers | null;
  drugBackgroundMeta: ReturnType<typeof mergeDynamicDrugBackgroundIntoCoreAnswers>['meta'];
  interviewId: string;
}): WorkerRiskItemDraft[] {
  const { scored, flags, riskSummary, reviewTriage, answersEffective, drugBackgroundMeta, interviewId } = args;
  const items: WorkerRiskItemDraft[] = [];
  const src: WorkerRiskItemSource = 'interview';
  const ref = interviewId;

  if (riskSummary?.drug) {
    const level = mapPrescreenSeverityToWorker(riskSummary.drug.level);
    if (level !== 'low' || flags.includes('drug_unknown')) {
      items.push({
        type: 'drug',
        severity: level,
        confidence: level === 'unknown' ? 0.55 : 0.72,
        summary: polishSummary(riskSummary.drug.reason),
        source: src,
        sourceRef: ref,
        status: 'active',
      });
    }
  }

  if (riskSummary?.background) {
    const level = mapPrescreenSeverityToWorker(riskSummary.background.level);
    if (level !== 'low' || flags.includes('background_unknown')) {
      items.push({
        type: 'background',
        severity: level,
        confidence: level === 'unknown' ? 0.55 : 0.72,
        summary: polishSummary(riskSummary.background.reason),
        source: src,
        sourceRef: ref,
        status: 'active',
      });
    }
  }

  if (flags.includes('attendance_risk') || normLower(answersEffective?.attendance_issues) === 'yes') {
    const expl = String(answersEffective?.attendance_explanation ?? '').trim();
    items.push({
      type: 'attendance',
      severity: 'moderate',
      confidence: 0.68,
      summary: expl
        ? `Attendance concern noted — explanation appears ${expl.length > 80 ? expl.slice(0, 77) + '…' : expl}`
        : 'Attendance reliability flagged in interview responses',
      source: src,
      sourceRef: ref,
      status: 'active',
    });
  }

  if (
    flags.some((f) => f.startsWith('transportation_')) ||
    reviewTriage?.subtype === 'reliability_transport'
  ) {
    const plan = normLower(answersEffective?.transportation_plan).replace(/_/g, ' ');
    let summary = 'Transportation reliability unclear — confirm schedule fit';
    if (plan.includes('ride') || plan.includes('someone else')) {
      summary = 'Transportation relies on others — reliability may vary';
    } else if (plan.includes('not sure')) {
      summary = 'Transportation plan uncertain — confirm before scheduling';
    }
    items.push({
      type: 'transportation',
      severity: 'moderate',
      confidence: 0.66,
      summary,
      source: src,
      sourceRef: ref,
      status: 'active',
    });
  }

  if (flags.includes('vague_response') || flags.includes('low_effort_response')) {
    items.push({
      type: 'communication',
      severity: 'low',
      confidence: 0.58,
      summary: 'Interview answers were thin or generic — confirm motivation and fit',
      source: src,
      sourceRef: ref,
      status: 'active',
    });
  }

  if (flags.includes('limited_relevant_experience')) {
    items.push({
      type: 'experience',
      severity: 'moderate',
      confidence: 0.6,
      summary: 'Limited direct experience for target role — skills may still transfer',
      source: src,
      sourceRef: ref,
      status: 'active',
    });
  }

  if (reviewTriage?.summaryShort && scored.recommendation === 'review') {
    const short = reviewTriage.summaryShort.trim();
    if (short && !items.some((i) => i.summary.includes(short.slice(0, 24)))) {
      items.push({
        type: 'job_fit',
        severity: 'low',
        confidence: 0.52,
        summary: polishSummary(short),
        source: src,
        sourceRef: ref,
        status: 'active',
      });
    }
  }

  return items;
}

function polishSummary(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= 140) return t;
  return `${t.slice(0, 137)}…`;
}

function pickTopRisks(candidates: WorkerRiskItemDraft[], max = 3): WorkerRiskItemDraft[] {
  const scored = candidates.map((c) => ({ c, w: severityWeight(c.severity) * (0.5 + c.confidence) }));
  scored.sort((a, b) => b.w - a.w);
  const out: WorkerRiskItemDraft[] = [];
  const seen = new Set<string>();
  for (const { c } of scored) {
    const key = `${c.type}:${c.summary.slice(0, 48)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function overallRiskScoreFromSignals(args: {
  prescreenOverall: number;
  interviewRiskDims: { complianceRisk: number; attendanceRisk: number; transportationRisk: number };
  categoryScores: PrescreenCategoryScoresV1 | null | undefined;
  complianceUserGaps: ComplianceGap[];
  topRisks: WorkerRiskItemDraft[];
}): number {
  const { prescreenOverall, interviewRiskDims, categoryScores, complianceUserGaps, topRisks } = args;
  const scoreWeakness = Math.max(0, Math.min(100, 100 - prescreenOverall));

  const dimAvg =
    (interviewRiskDims.complianceRisk + interviewRiskDims.attendanceRisk + interviewRiskDims.transportationRisk) / 3;
  const dimComponent = dimAvg * 100;

  let catStress = 0;
  if (categoryScores) {
    const vals = [
      categoryScores.jobReadiness,
      categoryScores.reliability,
      categoryScores.stability,
      categoryScores.punctuality,
    ];
    for (const v of vals) {
      if (v < 55) catStress += (55 - v) * 0.35;
    }
  }
  catStress = Math.min(35, catStress);

  const complianceBoost = Math.min(
    28,
    complianceUserGaps.reduce((acc, g) => acc + severityWeight(g.severity) * 4, 0),
  );

  const topSeverityBoost = topRisks.reduce((acc, r) => acc + severityWeight(r.severity) * 2.5, 0);

  const raw =
    scoreWeakness * 0.34 +
    dimComponent * 0.22 +
    catStress * 0.18 +
    complianceBoost * 0.16 +
    Math.min(12, topSeverityBoost);

  return Math.round(Math.max(0, Math.min(100, raw)));
}

function buildInputFingerprint(args: {
  prescreenOverall: number;
  flags: string[];
  category: PrescreenCategoryScoresV1 | null | undefined;
  userCompliance: Record<string, unknown>;
}): string {
  const { prescreenOverall, flags, category, userCompliance } = args;
  const f = [...flags].sort().join('|');
  const cat = category
    ? `${category.reliability}:${category.punctuality}:${category.workEthic}:${category.teamFit}:${category.jobReadiness}:${category.stability}`
    : '';
  const uc = `${normLower(userCompliance.employeeOnboardStatus)}|${everifyCaseStateFromUser(userCompliance)}|${Array.isArray(userCompliance.eVerifyOrders) ? userCompliance.eVerifyOrders.length : 0}`;
  return sha256Hex(`${prescreenOverall}#${f}#${cat}#${uc}`);
}

/** Interview submit / synchronous rescoring — use full answers for transportation + attendance context. */
export function buildWorkerRiskProfileFromBundleWithAnswers(
  bundle: ComposedPrescreenAiBundle,
  answers: import('./scoreWorkerAiPrescreen').WorkerAiPrescreenAnswers,
  dynamicAnswers: Record<string, string>,
  userDoc: Record<string, unknown>,
  interviewId: string,
  lastGeneratedBy: WorkerRiskProfileDraft['lastGeneratedBy'],
  /** Same source as `buildWorkerRiskProfileFromLatestInterview` (`prescreen.data.createdAt` / `timestamp`). */
  interviewCreatedAt?: admin.firestore.Timestamp | null,
): WorkerRiskProfileDraft {
  const { merged: answersEffective, meta: drugBackgroundMeta } = mergeDynamicDrugBackgroundIntoCoreAnswers(
    answers,
    dynamicAnswers,
  );
  const scored = bundle.scored;
  const trustOverall = bundle.operationalOverride?.adjustedScore ?? scored.overallScore;
  const flags = bundle.aiFlags;
  const categoryScores = bundle.categoryScores;
  const dims = computeInterviewRiskDimensions(answersEffective, drugBackgroundMeta);
  const reviewTriageForRisk =
    (bundle.aiBlockCore as { reviewTriage?: typeof scored.reviewTriage }).reviewTriage ?? scored.reviewTriage ?? null;

  const complianceGaps = complianceGapsFromUser(userDoc);
  const gapItems: WorkerRiskItemDraft[] = complianceGaps.map((g) => ({
    type: g.type,
    severity: g.severity,
    confidence: g.confidence,
    summary: g.summary,
    source: 'onboarding' as const,
    status: 'active' as const,
  }));

  const interviewItems = interviewDerivedRisks({
    scored,
    flags,
    riskSummary: scored.riskSummary,
    reviewTriage: reviewTriageForRisk,
    answersEffective,
    drugBackgroundMeta,
    interviewId,
  });

  const mergedCategory = categoryV1FromUserDoc(userDoc) ?? categoryScores ?? null;
  const catItems = categoryWeaknessRisks(mergedCategory);

  const candidates = [...gapItems, ...interviewItems, ...catItems];
  const topRisksPicked = pickTopRisks(candidates, 3);
  const topRisks = normalizeRiskItemSummariesInDraft(topRisksPicked);

  const overallRiskScore = overallRiskScoreFromSignals({
    prescreenOverall: trustOverall,
    interviewRiskDims: dims,
    categoryScores: mergedCategory,
    complianceUserGaps: complianceGaps,
    topRisks,
  });

  const userComplianceSnap: Record<string, unknown> = {
    employeeOnboardStatus: userDoc.employeeOnboardStatus,
    contractorOnboardStatus: userDoc.contractorOnboardStatus,
    eVerifyOrders: userDoc.eVerifyOrders,
    comfortableEVerify: userDoc.comfortableEVerify,
    workerAttestations: userDoc.workerAttestations,
  };

  const fp = buildInputFingerprint({
    prescreenOverall: trustOverall,
    flags,
    category: mergedCategory,
    userCompliance: userComplianceSnap,
  });

  const complianceSnapshotAt = admin.firestore.Timestamp.now();
  const staleness = buildRiskProfileStalenessPayload({
    interviewCreatedAt: interviewCreatedAt ?? null,
    userDoc,
    complianceSnapshotAt,
  });

  const generationSignature = sha256Hex(
    stableStringify({
      v: WORKER_RISK_PROFILE_VERSION,
      overallRiskScore,
      lastGeneratedBy,
      topRisks: topRisks.map((t) => ({
        type: t.type,
        severity: t.severity,
        confidence: Math.round(t.confidence * 1000) / 1000,
        summary: t.summary,
        source: t.source,
        sourceRef: t.sourceRef ?? null,
      })),
      fp,
    }),
  );

  return {
    overallRiskScore,
    topRisks,
    lastGeneratedBy,
    version: WORKER_RISK_PROFILE_VERSION,
    generationSignature,
    staleness,
  };
}

/**
 * Build from latest stored worker_ai_prescreen interview (score_review / backfill).
 */
export async function buildWorkerRiskProfileFromLatestInterview(
  db: Firestore,
  uid: string,
  userDoc: Record<string, unknown>,
  lastGeneratedBy: WorkerRiskProfileDraft['lastGeneratedBy'],
): Promise<WorkerRiskProfileDraft | null> {
  const interviewsRef = db.collection('users').doc(uid).collection('interviews');
  let snap;
  try {
    snap = await interviewsRef.orderBy('createdAt', 'desc').get();
  } catch {
    try {
      snap = await interviewsRef.orderBy('timestamp', 'desc').get();
    } catch {
      snap = await interviewsRef.get();
    }
  }
  const docs = snap.docs
    .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
    .filter((x) => x.data && x.data.isArchived !== true);

  const prescreen = docs.find((d) => d.data.interviewKind === 'worker_ai_prescreen');
  if (!prescreen) return null;

  const { answers, dynamicAnswers } = extractPrescreenAnswersFromInterviewDoc(prescreen.data);
  const ai = prescreen.data.ai as Record<string, unknown> | undefined;
  if (!ai) return null;

  const overallScore =
    typeof ai.overrideAdjustedScore === 'number'
      ? ai.overrideAdjustedScore
      : typeof ai.overallScore === 'number'
        ? ai.overallScore
        : null;
  if (overallScore == null) return null;

  const flags = (Array.isArray(ai.flags) ? ai.flags : []) as string[];
  const riskSummary = ai.riskSummary as PrescreenRiskSummary | undefined;
  const reviewTriage = ai.reviewTriage as PrescreenReviewTriage | undefined;

  const scoredLike: AiPrescreenScoreResult = {
    overallScore: overallScore,
    recommendation: (ai.recommendation as AiPrescreenScoreResult['recommendation']) || 'review',
    reviewKind: ai.reviewKind as AiPrescreenScoreResult['reviewKind'],
    flags,
    summary: String(ai.summary ?? ''),
    subScores: (ai.subScores as AiPrescreenScoreResult['subScores']) || {
      experience: 0,
      reliability: 0,
      transportation: 0,
      risk: 0,
      physical: 0,
    },
    riskSummary,
    reviewTriage: reviewTriage ?? undefined,
  };

  let answersEffective = answers;
  let meta = undefined as ReturnType<typeof mergeDynamicDrugBackgroundIntoCoreAnswers>['meta'];
  if (answers) {
    const m = mergeDynamicDrugBackgroundIntoCoreAnswers(answers, dynamicAnswers);
    answersEffective = m.merged;
    meta = m.meta;
  }

  const dims = computeInterviewRiskDimensions(answersEffective ?? ({} as import('./scoreWorkerAiPrescreen').WorkerAiPrescreenAnswers), meta);

  const complianceGaps = complianceGapsFromUser(userDoc);
  const gapItems: WorkerRiskItemDraft[] = complianceGaps.map((g) => ({
    type: g.type,
    severity: g.severity,
    confidence: g.confidence,
    summary: g.summary,
    source: 'onboarding' as const,
    status: 'active' as const,
  }));

  const interviewItems = interviewDerivedRisks({
    scored: scoredLike,
    flags,
    riskSummary,
    reviewTriage: reviewTriage ?? null,
    answersEffective,
    drugBackgroundMeta: meta,
    interviewId: prescreen.id,
  });

  const mergedCategory = categoryV1FromUserDoc(userDoc) ?? null;
  const catItems = categoryWeaknessRisks(mergedCategory);

  const candidates = [...gapItems, ...interviewItems, ...catItems];
  const topRisksPicked = pickTopRisks(candidates, 3);
  const topRisks = normalizeRiskItemSummariesInDraft(topRisksPicked);

  const overallRiskScore = overallRiskScoreFromSignals({
    prescreenOverall: overallScore,
    interviewRiskDims: dims,
    categoryScores: mergedCategory,
    complianceUserGaps: complianceGaps,
    topRisks,
  });

  const userComplianceSnap: Record<string, unknown> = {
    employeeOnboardStatus: userDoc.employeeOnboardStatus,
    contractorOnboardStatus: userDoc.contractorOnboardStatus,
    eVerifyOrders: userDoc.eVerifyOrders,
    comfortableEVerify: userDoc.comfortableEVerify,
    workerAttestations: userDoc.workerAttestations,
  };

  const fp = buildInputFingerprint({
    prescreenOverall: overallScore,
    flags,
    category: mergedCategory,
    userCompliance: userComplianceSnap,
  });

  const prescreenCreated =
    (prescreen.data.createdAt as admin.firestore.Timestamp | undefined) ||
    (prescreen.data.timestamp as admin.firestore.Timestamp | undefined);
  const complianceSnapshotAt = admin.firestore.Timestamp.now();
  const staleness = buildRiskProfileStalenessPayload({
    interviewCreatedAt: prescreenCreated ?? null,
    userDoc,
    complianceSnapshotAt,
  });

  const generationSignature = sha256Hex(
    stableStringify({
      v: WORKER_RISK_PROFILE_VERSION,
      overallRiskScore,
      lastGeneratedBy,
      topRisks: topRisks.map((t) => ({
        type: t.type,
        severity: t.severity,
        confidence: Math.round(t.confidence * 1000) / 1000,
        summary: t.summary,
        source: t.source,
        sourceRef: t.sourceRef ?? null,
      })),
      fp,
    }),
  );

  return {
    overallRiskScore,
    topRisks,
    lastGeneratedBy,
    version: WORKER_RISK_PROFILE_VERSION,
    generationSignature,
    staleness,
  };
}

export function riskProfileFirestorePayload(draft: WorkerRiskProfileDraft): Record<string, unknown> {
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const topRisks = draft.topRisks.map((r) => {
    const row: Record<string, unknown> = {
      type: r.type,
      severity: r.severity,
      confidence: r.confidence,
      summary: r.summary,
      source: r.source,
      lastUpdatedAt: ts,
    };
    if (r.sourceRef != null && r.sourceRef !== '') row.sourceRef = r.sourceRef;
    if (r.status != null) row.status = r.status;
    return row;
  });
  const out: Record<string, unknown> = {
    overallRiskScore: draft.overallRiskScore,
    topRisks,
    lastUpdatedAt: ts,
    lastGeneratedBy: draft.lastGeneratedBy,
    version: draft.version,
    generationSignature: draft.generationSignature,
  };
  if (draft.staleness != null && typeof draft.staleness === 'object') {
    out.staleness = draft.staleness;
  }
  return out;
}

/**
 * Merge risk profile onto user update if signature changed. Returns fields to merge into `.update()` payload.
 */
export function mergeRiskProfileIntoUserUpdateIfChanged(
  existingUserData: Record<string, unknown> | undefined,
  draft: WorkerRiskProfileDraft | null,
  opts?: { touchUpdatedAt?: boolean },
): Record<string, unknown> | null {
  if (!draft) return null;
  const prev = existingUserData?.riskProfile as { generationSignature?: string } | undefined;
  if (prev?.generationSignature === draft.generationSignature) {
    logger.info('workerRiskProfile.skip_unchanged', { signature: draft.generationSignature.slice(0, 16) });
    return null;
  }
  const out: Record<string, unknown> = {
    riskProfile: riskProfileFirestorePayload(draft),
  };
  if (opts?.touchUpdatedAt) {
    out.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  }
  return out;
}

/** @deprecated Prefer `refreshWorkerRiskProfileForUidCanonical` — thin wrapper for backward compatibility */
export async function refreshWorkerRiskProfileForUid(db: Firestore, uid: string): Promise<void> {
  const { refreshWorkerRiskProfileForUidCanonical } = await import('./workerRiskProfileRefreshCanonical');
  const r = await refreshWorkerRiskProfileForUidCanonical(db, uid, { dryRun: false });
  if (r.status === 'error') {
    logger.warn('workerRiskProfile.refresh_failed', { uid, err: r.errorMessage });
  }
}
