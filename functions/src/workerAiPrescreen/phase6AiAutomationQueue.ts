/**
 * Phase 6 — controlled automation: queue only (no onboarding, status changes, or external calls).
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import type { AiHiringDecisionResult } from './evaluateAiHiringDecision';
import type { HiringContainerRef, ResolvedAiHiringPolicy } from './aiHiringPolicyResolution';

export type Phase6SkipReason =
  | 'policy_disabled'
  | 'not_eligible'
  | 'max_reached'
  | 'target_reached'
  | 'already_queued'
  | 'no_container';

const QUEUE_STATUSES_COUNTING_TOWARD_MAX = new Set(['pending', 'processing', 'advanced', 'completed']);

function containerKey(container: HiringContainerRef): string | null {
  if (container.kind === 'job_order') return `jobOrder:${container.jobOrderId}`;
  if (container.kind === 'group') return `group:${container.groupId}`;
  return null;
}

function matchesContainer(
  data: Record<string, unknown>,
  container: HiringContainerRef,
): boolean {
  const jobOrderId = String(data.jobOrderId ?? '').trim();
  const groupId = String(data.groupId ?? '').trim();
  if (container.kind === 'job_order') {
    return jobOrderId === container.jobOrderId;
  }
  if (container.kind === 'group') {
    return groupId === container.groupId;
  }
  return false;
}

/**
 * After aiAutomation is written: optionally enqueue Phase 6 automation (queue doc only).
 * @returns true only when `aiAutomationQueue` was actually written to the application doc.
 */
export async function maybeWritePhase6AutomationQueue(args: {
  db: admin.firestore.Firestore;
  tenantId: string;
  applicationId: string;
  userId: string;
  interviewId: string;
  score: number;
  hiringResult: AiHiringDecisionResult;
  resolvedPolicy: ResolvedAiHiringPolicy;
  container: HiringContainerRef;
}): Promise<boolean> {
  const {
    db,
    tenantId,
    applicationId,
    userId,
    interviewId,
    score,
    hiringResult,
    resolvedPolicy,
    container,
  } = args;

  const policy = resolvedPolicy;
  const ck = containerKey(container);

  const logSkip = (reason: Phase6SkipReason, extra?: Record<string, unknown>) => {
    logger.info('worker_ai_automation.phase6_skipped', {
      userId,
      applicationId,
      interviewId,
      reason,
      decision: hiringResult.decision,
      score,
      containerId: ck,
      ...extra,
    });
  };

  // --- Part A: eligibility (policy + decision) ---
  if (!policy.autoAdvanceEnabled) {
    logSkip('policy_disabled');
    return false;
  }
  if (
    hiringResult.decision !== 'advance' ||
    !hiringResult.eligibleForAutoAdvance
  ) {
    logSkip('not_eligible');
    return false;
  }

  if (container.kind === 'none' || !ck) {
    logSkip('no_container');
    return false;
  }

  const appRef = db.doc(`tenants/${tenantId}/applications/${applicationId}`);
  const appSnap = await appRef.get();
  if (!appSnap.exists) {
    logSkip('not_eligible', { detail: 'application_missing' });
    return false;
  }
  const existing = appSnap.data() as Record<string, unknown>;
  if (existing.aiAutomationQueue && typeof existing.aiAutomationQueue === 'object') {
    logSkip('already_queued');
    return false;
  }

  // --- Query peer applications in same container (cap for reads) ---
  const appsCol = db.collection(`tenants/${tenantId}/applications`);
  let peerQuery: admin.firestore.Query = appsCol;
  if (container.kind === 'job_order') {
    peerQuery = peerQuery.where('jobOrderId', '==', container.jobOrderId);
  } else {
    peerQuery = peerQuery.where('groupId', '==', container.groupId);
  }

  let peerSnap: admin.firestore.QuerySnapshot;
  try {
    peerSnap = await peerQuery.limit(500).get();
  } catch (e) {
    logger.warn('phase6AiAutomationQueue.peer_query_failed', {
      tenantId,
      applicationId,
      message: e instanceof Error ? e.message : String(e),
    });
    logSkip('no_container', { detail: 'peer_query_failed' });
    return false;
  }

  let queueSlotCount = 0;
  let onboardingPipelineCount = 0;
  let advanceDecisionCount = 0;

  for (const d of peerSnap.docs) {
    const data = d.data() as Record<string, unknown>;
    if (!matchesContainer(data, container)) continue;

    const q = data.aiAutomationQueue as Record<string, unknown> | undefined;
    const st = q && typeof q.status === 'string' ? q.status : '';
    if (st && QUEUE_STATUSES_COUNTING_TOWARD_MAX.has(st)) {
      queueSlotCount += 1;
    }

    const cStat = String(data.candidateStatus ?? data.candidate_status ?? '').toLowerCase();
    const appStat = String(data.status ?? '').toLowerCase();
    if (cStat === 'onboarding' || appStat === 'onboarding') {
      onboardingPipelineCount += 1;
    }

    const ai = data.aiAutomation as Record<string, unknown> | undefined;
    if (ai && ai.decision === 'advance') {
      advanceDecisionCount += 1;
    }
  }

  // --- Part B: hard gating ---
  if (
    typeof policy.maximumAutoAdvances === 'number' &&
    Number.isFinite(policy.maximumAutoAdvances) &&
    queueSlotCount >= policy.maximumAutoAdvances
  ) {
    logSkip('max_reached', {
      queueSlotCount,
      maximumAutoAdvances: policy.maximumAutoAdvances,
    });
    return false;
  }

  if (
    typeof policy.targetOnboardingCount === 'number' &&
    Number.isFinite(policy.targetOnboardingCount) &&
    onboardingPipelineCount >= policy.targetOnboardingCount
  ) {
    logSkip('target_reached', {
      targetKind: 'onboarding_pipeline',
      onboardingPipelineCount,
      targetOnboardingCount: policy.targetOnboardingCount,
    });
    return false;
  }

  if (
    policy.stopWhenTargetReached === true &&
    typeof policy.targetReadyCount === 'number' &&
    Number.isFinite(policy.targetReadyCount) &&
    advanceDecisionCount >= policy.targetReadyCount
  ) {
    logSkip('target_reached', {
      targetKind: 'ready_decision_cap',
      advanceDecisionCount,
      targetReadyCount: policy.targetReadyCount,
    });
    return false;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const queuePayload = {
    status: 'pending' as const,
    actions: ['advance_candidate'] as const,
    createdAt: now,
    gatingSnapshot: {
      decision: hiringResult.decision,
      score,
      eligibleForAutoAdvance: hiringResult.eligibleForAutoAdvance,
      policy: {
        autoAdvanceEnabled: policy.autoAdvanceEnabled,
        maximumAutoAdvances: policy.maximumAutoAdvances,
        targetOnboardingCount: policy.targetOnboardingCount,
      },
    },
  };

  await appRef.set({ aiAutomationQueue: queuePayload }, { merge: true });

  logger.info('worker_ai_automation.phase6_queue_created', {
    userId,
    applicationId,
    decision: hiringResult.decision,
    score,
    containerId: ck,
    queueStatus: 'pending' as const,
    interviewId,
  });

  return true;
}
