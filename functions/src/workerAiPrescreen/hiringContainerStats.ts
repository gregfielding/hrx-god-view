/**
 * Hiring container stats for orchestrator + aiHiringStats persistence.
 * @see orchestratorV1Types.ts for canonical definitions (v1).
 */

import { FieldValue } from 'firebase-admin/firestore';
import type {
  Firestore,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
} from 'firebase-admin/firestore';
import { normalizeApplicationStatus } from '../utils/applicationStatusNormalize';
import type { HiringContainerRef } from './aiHiringPolicyResolution';
import type { ContainerStatsInput } from './evaluateAiHiringDecision';

export const AI_HIRING_STATS_DEFINITIONS_VERSION = 1;

function isTruthyCompletedInterview(data: Record<string, unknown>): boolean {
  return data.workerAiPrescreenInterviewCompletedAt != null;
}

function countsForApplicationDoc(
  data: Record<string, unknown>,
  workerAiPrescreenRequired: boolean,
): {
  ready: boolean;
  onboarding: boolean;
  applicant: boolean;
  interviewed: boolean;
} {
  const status = normalizeApplicationStatus(String(data.status ?? ''));
  const ready = status === 'accepted';
  const onboarding = status === 'interview' || status === 'offer_pending';
  const applicant = status !== 'withdrawn';
  const prescreenCountsAsInterview =
    workerAiPrescreenRequired === false
      ? status === 'submitted' || isTruthyCompletedInterview(data)
      : isTruthyCompletedInterview(data);
  const interviewed =
    status === 'interview' ||
    status === 'offer_pending' ||
    status === 'accepted' ||
    prescreenCountsAsInterview;
  return { ready, onboarding, applicant, interviewed };
}

function aggregateStats(
  docs: QueryDocumentSnapshot[],
  workerAiPrescreenRequired: boolean,
): ContainerStatsInput {
  let currentReadyCount = 0;
  let currentOnboardingCount = 0;
  let totalApplicants = 0;
  let totalInterviewed = 0;
  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    const c = countsForApplicationDoc(data, workerAiPrescreenRequired);
    if (c.ready) currentReadyCount += 1;
    if (c.onboarding) currentOnboardingCount += 1;
    if (c.applicant) totalApplicants += 1;
    if (c.interviewed) totalInterviewed += 1;
  }
  return { currentReadyCount, currentOnboardingCount, totalApplicants, totalInterviewed };
}

/**
 * Loads peer applications for the hiring container (same query shape as phase6AiAutomationQueue).
 * Computes stats in memory (cap 500 docs).
 */
export async function loadHiringContainerStats(
  db: Firestore,
  tenantId: string,
  container: HiringContainerRef,
  options?: { workerAiPrescreenRequired?: boolean },
): Promise<ContainerStatsInput> {
  if (container.kind === 'none') {
    return {};
  }
  const workerAiPrescreenRequired = options?.workerAiPrescreenRequired !== false;
  const appsCol = db.collection(`tenants/${tenantId}/applications`);
  let peerQuery: Query = appsCol;
  if (container.kind === 'job_order') {
    peerQuery = peerQuery.where('jobOrderId', '==', container.jobOrderId);
  } else {
    peerQuery = peerQuery.where('groupId', '==', container.groupId);
  }
  const peerSnap = await peerQuery.limit(500).get();
  return aggregateStats(peerSnap.docs, workerAiPrescreenRequired);
}

/**
 * Persists last computed stats on the job order or group doc for observability (optional read cache).
 */
/** Job fit from `tenants/.../applications/{id}.scores.fitScore` (AI fit pipeline). */
export function extractJobFitScore(app: Record<string, unknown>): number | null {
  const scores = app.scores as Record<string, unknown> | undefined;
  if (scores && typeof scores.fitScore === 'number' && Number.isFinite(scores.fitScore)) {
    return scores.fitScore;
  }
  return null;
}

/**
 * Assignment-level no-show is used only when exactly one assignment matches both `applicationId` and `jobOrderId`.
 */
export async function loadScopedAssignmentNoShowBand(
  db: Firestore,
  tenantId: string,
  applicationId: string,
  jobOrderId: string | null | undefined,
): Promise<{ band: string | null; score: number | null; assignmentId: string | null }> {
  if (!jobOrderId) return { band: null, score: null, assignmentId: null };
  let q: QuerySnapshot;
  try {
    q = await db
      .collection(`tenants/${tenantId}/assignments`)
      .where('applicationId', '==', applicationId)
      .where('jobOrderId', '==', jobOrderId)
      .limit(3)
      .get();
  } catch {
    return { band: null, score: null, assignmentId: null };
  }
  if (q.size !== 1) return { band: null, score: null, assignmentId: null };
  const data = q.docs[0].data() as Record<string, unknown>;
  const pred = data.noShowRiskPredictionV1 as Record<string, unknown> | undefined;
  const band = pred && typeof pred.band === 'string' ? pred.band : null;
  const score =
    pred && typeof pred.score === 'number' && Number.isFinite(pred.score) ? (pred.score as number) : null;
  return { band, score, assignmentId: q.docs[0].id };
}

export async function persistAiHiringStatsSnapshot(
  db: Firestore,
  tenantId: string,
  container: HiringContainerRef,
  stats: ContainerStatsInput,
): Promise<void> {
  if (container.kind === 'none') return;
  const payload = {
    aiHiringStats: {
      definitionsVersion: AI_HIRING_STATS_DEFINITIONS_VERSION,
      currentReadyCount: stats.currentReadyCount ?? null,
      currentOnboardingCount: stats.currentOnboardingCount ?? null,
      totalApplicants: stats.totalApplicants ?? null,
      totalInterviewed: stats.totalInterviewed ?? null,
      computedAt: FieldValue.serverTimestamp(),
    },
  };
  if (container.kind === 'job_order') {
    await db.doc(`tenants/${tenantId}/job_orders/${container.jobOrderId}`).set(payload, { merge: true });
    return;
  }
  await db.doc(`tenants/${tenantId}/groups/${container.groupId}`).set(payload, { merge: true });
}
