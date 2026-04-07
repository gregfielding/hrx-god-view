import * as admin from 'firebase-admin';
import { ASSIGNMENT_READINESS_V1_EVALUATOR_VERSION } from './assignmentReadinessV1Version';
import { deriveAssignmentReadinessPayload, type BackgroundCheckLite } from './assignmentReadinessDerive';
import {
  coerceOnboardingInstanceLite,
  type OnboardingInstanceLite,
} from './assignmentReadinessFromInstance';
import type { AssignmentReadinessStateV1, AssignmentReadinessSectionRowV1 } from '../types/assignmentReadinessV1';

/** Tenant + assignment doc id for recomputing `assignmentReadinessV1`. */
export type AssignmentReadinessLinkage = { tenantId: string; assignmentId: string };

/**
 * Resolves which assignment(s) a `backgroundChecks/{id}` write should refresh.
 * Order: (1) non-empty `automationAssignmentId` on the check → single linkage;
 * (2) else `tenantId` + `candidateId` or `userId` + `jobOrderId` → assignments under that tenant matching both.
 */
export async function resolveAssignmentReadinessLinkagesFromBackgroundCheckData(
  db: admin.firestore.Firestore,
  row: Record<string, unknown> | null | undefined
): Promise<AssignmentReadinessLinkage[]> {
  if (!row || typeof row !== 'object') return [];
  const tenantId = String(row.tenantId || '').trim();
  if (!tenantId) return [];

  const automationAssignmentId = String(row.automationAssignmentId || '').trim();
  if (automationAssignmentId) {
    return [{ tenantId, assignmentId: automationAssignmentId }];
  }

  const uid = String(row.candidateId || row.userId || '').trim();
  const jobOrderId = String(row.jobOrderId || '').trim();
  if (!uid || !jobOrderId) return [];

  const assignmentsRef = db.collection(`tenants/${tenantId}/assignments`);
  const [byUser, byCandidate] = await Promise.all([
    assignmentsRef.where('userId', '==', uid).where('jobOrderId', '==', jobOrderId).limit(25).get(),
    assignmentsRef
      .where('candidateId', '==', uid)
      .where('jobOrderId', '==', jobOrderId)
      .limit(25)
      .get(),
  ]);

  const byId = new Map<string, AssignmentReadinessLinkage>();
  for (const d of [...byUser.docs, ...byCandidate.docs]) {
    byId.set(d.id, { tenantId, assignmentId: d.id });
  }
  return Array.from(byId.values());
}

export type AssignmentReadinessPersistedComparable = {
  assignmentReadinessState: AssignmentReadinessStateV1;
  assignmentSectionStatuses: AssignmentReadinessSectionRowV1[];
  blockingRequirementIds: string[];
  readinessSummary: string | null;
  evaluatorVersion: number;
};

function stableSerialize(p: AssignmentReadinessPersistedComparable): string {
  return JSON.stringify({
    assignmentReadinessState: p.assignmentReadinessState,
    assignmentSectionStatuses: p.assignmentSectionStatuses,
    blockingRequirementIds: [...p.blockingRequirementIds].sort(),
    readinessSummary: p.readinessSummary,
    evaluatorVersion: p.evaluatorVersion,
  });
}

function coerceExistingAssignmentReadinessFromDoc(
  root: Record<string, unknown>
): AssignmentReadinessPersistedComparable | null {
  if (typeof root.assignmentReadinessState !== 'string') return null;
  if (!Array.isArray(root.assignmentSectionStatuses)) return null;
  if (!Array.isArray(root.blockingRequirementIds)) return null;
  if (root.readinessSummary != null && typeof root.readinessSummary !== 'string') return null;
  if (typeof root.evaluatorVersion !== 'number') return null;
  return {
    assignmentReadinessState: root.assignmentReadinessState as AssignmentReadinessStateV1,
    assignmentSectionStatuses: root.assignmentSectionStatuses as AssignmentReadinessSectionRowV1[],
    blockingRequirementIds: root.blockingRequirementIds as string[],
    readinessSummary: (root.readinessSummary as string) ?? null,
    evaluatorVersion: root.evaluatorVersion as number,
  };
}

async function loadEnvelopeMap(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const snap = await db
      .collection(`tenants/${tenantId}/signature_envelopes`)
      .where('assignmentId', '==', assignmentId)
      .get();
    snap.docs.forEach((d) => {
      const data = d.data() as { docKey?: string; status?: string };
      if (data.docKey && data.status) map.set(data.docKey, data.status);
    });
  } catch {
    /* query / index */
  }
  return map;
}

async function loadBackgroundChecksForAssignment(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string,
  userId: string | null,
  jobOrderId: string | null
): Promise<BackgroundCheckLite[]> {
  const merged = new Map<string, BackgroundCheckLite>();
  const addDoc = (d: admin.firestore.QueryDocumentSnapshot) => {
    const x = d.data() as { hrxStatus?: string };
    merged.set(d.id, { id: d.id, hrxStatus: String(x.hrxStatus || '') });
  };

  try {
    const s = await db
      .collection('backgroundChecks')
      .where('tenantId', '==', tenantId)
      .where('automationAssignmentId', '==', assignmentId)
      .limit(40)
      .get();
    s.docs.forEach(addDoc);
  } catch {
    /* composite index may be missing */
  }

  if (userId) {
    try {
      const s2 = await db
        .collection('backgroundChecks')
        .where('tenantId', '==', tenantId)
        .where('candidateId', '==', userId)
        .limit(120)
        .get();
      s2.docs.forEach((d) => {
        const x = d.data() as { jobOrderId?: string; automationAssignmentId?: string };
        if (String(x.automationAssignmentId || '') === assignmentId) {
          addDoc(d);
          return;
        }
        const j = String(x.jobOrderId || '');
        if (jobOrderId && j && j !== jobOrderId) return;
        addDoc(d);
      });
    } catch {
      /* */
    }
  }

  return Array.from(merged.values());
}

/**
 * Recomputes and merges `assignmentReadinessV1` on the assignment doc when the comparable payload changes.
 */
export async function persistAssignmentReadinessV1IfChanged(
  db: admin.firestore.Firestore,
  tenantId: string,
  assignmentId: string
): Promise<{ wrote: boolean }> {
  const aid = String(assignmentId || '').trim();
  const tid = String(tenantId || '').trim();
  if (!aid || !tid) return { wrote: false };

  const assignRef = db.doc(`tenants/${tid}/assignments/${aid}`);
  const assignSnap = await assignRef.get();
  if (!assignSnap.exists) return { wrote: false };

  const a = assignSnap.data() as Record<string, unknown>;
  const statusRaw = String(a.status || '');
  const userId = String(a.userId || a.candidateId || '').trim() || null;
  const jobOrderId = String(a.jobOrderId || '').trim() || null;

  const instanceId = String(a.onboardingInstanceId || aid).trim();
  let instance: OnboardingInstanceLite | null = null;
  try {
    const instSnap = await db.doc(`tenants/${tid}/onboarding_instances/${instanceId}`).get();
    if (instSnap.exists) {
      instance = coerceOnboardingInstanceLite(instSnap.data() as Record<string, unknown>);
    }
  } catch {
    /* */
  }

  const envelopeByDocKey = await loadEnvelopeMap(db, tid, aid);
  const backgroundChecks = await loadBackgroundChecksForAssignment(db, tid, aid, userId, jobOrderId);

  const derived = deriveAssignmentReadinessPayload({
    assignmentId: aid,
    assignmentStatusRaw: statusRaw,
    instance,
    envelopeByDocKey,
    backgroundChecks,
  });

  const nextComparable: AssignmentReadinessPersistedComparable = {
    ...derived,
    evaluatorVersion: ASSIGNMENT_READINESS_V1_EVALUATOR_VERSION,
  };

  const existingRoot = (a.assignmentReadinessV1 || {}) as Record<string, unknown>;
  const existingComparable = coerceExistingAssignmentReadinessFromDoc(existingRoot);

  if (
    existingComparable &&
    stableSerialize(existingComparable) === stableSerialize(nextComparable)
  ) {
    return { wrote: false };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await assignRef.set(
    {
      'assignmentReadinessV1.assignmentReadinessState': derived.assignmentReadinessState,
      'assignmentReadinessV1.assignmentSectionStatuses': derived.assignmentSectionStatuses,
      'assignmentReadinessV1.blockingRequirementIds': derived.blockingRequirementIds,
      'assignmentReadinessV1.readinessSummary': derived.readinessSummary,
      'assignmentReadinessV1.lastEvaluatedAt': now,
      'assignmentReadinessV1.evaluatorVersion': ASSIGNMENT_READINESS_V1_EVALUATOR_VERSION,
      updatedAt: now,
    },
    { merge: true }
  );

  return { wrote: true };
}
