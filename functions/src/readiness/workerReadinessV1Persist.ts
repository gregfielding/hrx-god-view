import * as admin from 'firebase-admin';
import { C1_TENANT_ID, isC1WorkerScope } from './c1WorkerScope';
import { deriveOverallWorkerState, type EntityEmploymentSignal, type AssignmentSignal } from './overallWorkerStateDerive';
import {
  buildWorkerProfileReadinessV1,
  type WorkerProfileReadinessV1,
} from './profileReadinessShared/profileReadinessEvaluator';
import { WORKER_READINESS_V1_EVALUATOR_VERSION } from './workerReadinessV1Version';
import type { WorkerState } from '../types/workforceStateV1';

function coerceEmploymentSignal(data: Record<string, unknown>): EntityEmploymentSignal {
  const statusLower = String(data.status || '').trim().toLowerCase();
  const employmentStateLower = String(data.employmentState || data.status || '')
    .trim()
    .toLowerCase();
  return { statusLower, employmentStateLower };
}

function mergeAssignmentSignalsFromDocs(
  docs: admin.firestore.QueryDocumentSnapshot[]
): AssignmentSignal[] {
  const byId = new Map<string, AssignmentSignal>();
  for (const d of docs) {
    const row = d.data() as Record<string, unknown>;
    byId.set(d.id, { statusRaw: String(row.status || '') });
  }
  return Array.from(byId.values());
}

export async function loadC1WorkerReadinessContext(
  db: admin.firestore.Firestore,
  uid: string
): Promise<{
  employments: EntityEmploymentSignal[];
  assignments: AssignmentSignal[];
}> {
  const [empUser, empCand, asgUser, asgCand] = await Promise.all([
    db.collection(`tenants/${C1_TENANT_ID}/entity_employments`).where('userId', '==', uid).get(),
    db.collection(`tenants/${C1_TENANT_ID}/entity_employments`).where('candidateId', '==', uid).limit(50).get(),
    db.collection(`tenants/${C1_TENANT_ID}/assignments`).where('userId', '==', uid).limit(200).get(),
    db.collection(`tenants/${C1_TENANT_ID}/assignments`).where('candidateId', '==', uid).limit(200).get(),
  ]);

  const empById = new Map<string, EntityEmploymentSignal>();
  for (const d of [...empUser.docs, ...empCand.docs]) {
    empById.set(d.id, coerceEmploymentSignal(d.data() as Record<string, unknown>));
  }

  const assignDocs = [...asgUser.docs, ...asgCand.docs];
  const assignments = mergeAssignmentSignalsFromDocs(assignDocs);

  return {
    employments: Array.from(empById.values()),
    assignments,
  };
}

export type RecomputedWorkerReadinessV1 = {
  profileReadiness: WorkerProfileReadinessV1;
  overallWorkerState: WorkerState;
};

const WORKER_STATES = new Set<WorkerState>([
  'applicant',
  'profile_incomplete',
  'onboarding_in_progress',
  'ready_for_placement',
  'active',
  'blocked',
  'inactive',
  'terminated',
]);

function coerceExistingProfileReadiness(raw: unknown): WorkerProfileReadinessV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.status !== 'string' || typeof o.completionPercent !== 'number') return null;
  if (!Array.isArray(o.sections) || !Array.isArray(o.blockingItemIds)) return null;
  if (!Array.isArray(o.importantItemIds) || !Array.isArray(o.recommendedItemIds)) return null;
  return o as unknown as WorkerProfileReadinessV1;
}

function coerceExistingOverallWorkerState(raw: unknown): WorkerState | null {
  if (typeof raw !== 'string') return null;
  const s = raw as WorkerState;
  return WORKER_STATES.has(s) ? s : null;
}

export async function recomputeWorkerReadinessV1ForUser(
  db: admin.firestore.Firestore,
  uid: string
): Promise<RecomputedWorkerReadinessV1 | null> {
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return null;
  const userData = userSnap.data() as Record<string, unknown>;
  if (!isC1WorkerScope(userData)) return null;

  const profileReadiness = buildWorkerProfileReadinessV1({
    userDoc: userData,
    authAvatarUrl: null,
    smsSnoozedUntilMs: 0,
  });

  const ctx = await loadC1WorkerReadinessContext(db, uid);

  const overallWorkerState = deriveOverallWorkerState({
    profileReadiness,
    employments: ctx.employments,
    assignments: ctx.assignments,
  });

  return { profileReadiness, overallWorkerState };
}

/**
 * Loads latest user doc, recomputes profile + overall worker state, and merges `workerReadinessV1` when changed.
 * Skips Firestore write when payload is unchanged (avoids trigger feedback loops).
 */
export async function persistWorkerReadinessV1ForUidIfChanged(
  db: admin.firestore.Firestore,
  uid: string
): Promise<{ wrote: boolean; skippedReason?: string }> {
  const trimmed = String(uid || '').trim();
  if (!trimmed) return { wrote: false, skippedReason: 'empty_uid' };

  const userRef = db.doc(`users/${trimmed}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { wrote: false, skippedReason: 'no_user' };
  const userData = userSnap.data() as Record<string, unknown>;
  if (!isC1WorkerScope(userData)) return { wrote: false, skippedReason: 'not_c1_worker_scope' };

  const profileReadiness = buildWorkerProfileReadinessV1({
    userDoc: userData,
    authAvatarUrl: null,
    smsSnoozedUntilMs: 0,
  });
  const ctx = await loadC1WorkerReadinessContext(db, trimmed);
  const overallWorkerState = deriveOverallWorkerState({
    profileReadiness,
    employments: ctx.employments,
    assignments: ctx.assignments,
  });

  const wr = (userData.workerReadinessV1 || {}) as Record<string, unknown>;
  const existingPr = coerceExistingProfileReadiness(wr.profileReadiness);
  const existingOverall = coerceExistingOverallWorkerState(wr.overallWorkerState);
  const existingVersion = typeof wr.evaluatorVersion === 'number' ? wr.evaluatorVersion : null;

  if (
    workerReadinessV1PayloadEquals({
      nextProfile: profileReadiness,
      nextOverall: overallWorkerState,
      existingProfile: existingPr,
      existingOverall,
      existingVersion,
    })
  ) {
    return { wrote: false, skippedReason: 'unchanged' };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await userRef.set(
    buildWorkerReadinessV1WritePayload({ profileReadiness, overallWorkerState, now }),
    { merge: true }
  );
  return { wrote: true };
}

export function workerReadinessV1PayloadEquals(args: {
  nextProfile: WorkerProfileReadinessV1;
  nextOverall: WorkerState;
  existingProfile: WorkerProfileReadinessV1 | null;
  existingOverall: WorkerState | null;
  existingVersion: number | null;
}): boolean {
  const { nextProfile, nextOverall, existingProfile, existingOverall, existingVersion } = args;
  if (existingVersion !== WORKER_READINESS_V1_EVALUATOR_VERSION) return false;
  if (existingOverall !== nextOverall) return false;
  if (!existingProfile) return false;
  try {
    return JSON.stringify(existingProfile) === JSON.stringify(nextProfile);
  } catch {
    return false;
  }
}

export function buildWorkerReadinessV1WritePayload(args: {
  profileReadiness: WorkerProfileReadinessV1;
  overallWorkerState: WorkerState;
  now: admin.firestore.FieldValue;
}): Record<string, unknown> {
  const { profileReadiness, overallWorkerState, now } = args;
  return {
    'workerReadinessV1.profileReadiness': profileReadiness,
    'workerReadinessV1.overallWorkerState': overallWorkerState,
    'workerReadinessV1.lastEvaluatedAt': now,
    'workerReadinessV1.evaluatorVersion': WORKER_READINESS_V1_EVALUATOR_VERSION,
    updatedAt: now,
  };
}
