/**
 * EE.5 — admin/CSA recovery surface for accidental Firestore deletions of
 * the Everee worker setup.
 *
 * Background
 * ----------
 * Two Firestore docs together encode "this worker is set up for payroll
 * with this entity":
 *
 *   1. `tenants/{tid}/worker_onboarding/{userId}__{entityKey}` — the
 *      pipeline doc with the step/milestone/task scaffold the worker view
 *      reads to render their onboarding checklist. Canonical creator is
 *      `ensureWorkerOnboardingPipeline()` in
 *      `functions/src/onboarding/workerOnboardingPipeline.ts`.
 *
 *   2. `tenants/{tid}/everee_workers/{entityId}__{userId}` — the linkage
 *      doc that says "this HRX worker maps to this Everee worker id under
 *      this Everee tenant". Canonical creator is `createWorkerIfNeeded()`
 *      in `functions/src/integrations/everee/evereeService.ts`. The
 *      `/c1/workers/payroll` route's eligibility filter
 *      (`buildPayrollEligibleEvereeTenantIdSet`, `src/utils/workerPayrollEligibility.ts`)
 *      requires both docs in order to surface the entity in the picker.
 *
 * Either doc can be wiped from the Firestore console (or by a misfiring
 * cleanup script) and the worker is then stuck:
 *   - Missing `worker_onboarding` → worker view shows no checklist; the
 *     iframe boots but downstream UI surfaces have nothing to render.
 *   - Missing `everee_workers` → `/c1/workers/payroll` filters that
 *     entity out of the picker, the admin "Everee data" card silently
 *     hides, the EE.4 EMB-202 recovery has nothing to clear stamps on.
 *
 * Recreating a worker on Everee from scratch is destructive (new Everee
 * worker id, lost onboarding progress). This callable instead rehydrates
 * both Firestore docs from sources of truth that already exist:
 *   - `users/{userId}.evereeWorkerIds[evereeTenantId]` for the worker id
 *     (set by `createWorkerIfNeeded` and authoritative).
 *   - `entities/{entityId}` for entity metadata + Everee tenant id.
 *   - `entity_employments/{userId}__{entityKey}` for the employment
 *     anchor (must exist; this is the "is this person employed here?"
 *     truth that recovery cannot fabricate).
 *
 * Idempotency
 * -----------
 * Both rehydrations are idempotent: present docs are never overwritten,
 * and the callable returns flags indicating which docs it actually wrote.
 * Safe to invoke from a "Recreate worker onboarding" button without
 * checking state first.
 *
 * Surgical scope
 * --------------
 * Unlike `ensureWorkerOnboardingPipeline`, this callable does NOT:
 *   - Touch `entity_employments` (the lifecycle there is owned by
 *     real onboarding events; recovery shouldn't reset
 *     `onboardingStartedAt`, `employmentEntryMode`, etc.).
 *   - Trigger I9 supporting requests (`ensureWorkerI9SupportingRequestsOnPipelineCreate`).
 *   - Dispatch worker-hired or pipeline-started messaging.
 *
 * The intent is "make the missing docs reappear with the same shape they
 * would have had if they'd never been deleted" — nothing more.
 */

import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import {
  PIPELINE_STEPS,
  STEP_MILESTONES,
  buildInitialTasks,
  computeStepApplicability,
  resolveEntityContext,
  timestampForNestedDoc,
  type PipelineStep,
  type PipelineTask,
} from "../../onboarding/workerOnboardingPipeline";
import { canManageEveree } from "./evereeCallables";

if (!admin.apps.length) {
  admin.initializeApp();
}

export interface BuildWorkerOnboardingRecoveryDocInput {
  tenantId: string;
  userId: string;
  userName: string;
  entityId: string | null;
  entityName: string;
  entityKey: "workforce" | "select" | "events";
  entityData?: {
    onboardingWorkflowSteps?: Record<string, boolean>;
    workerType?: string;
    everifyRequired?: boolean;
  };
  /** Audit field — `users/{auditUid}` who triggered the recovery. */
  triggeredByUid: string;
  /** When provided (`Timestamp.now()` from caller), used for nested step.updatedAt. */
  nestedTimestamp: admin.firestore.Timestamp;
  /** Server timestamp sentinel for top-level createdAt/updatedAt. */
  serverTimestamp: admin.firestore.FieldValue;
}

export interface WorkerOnboardingRecoveryDoc {
  tenantId: string;
  userId: string;
  userName: string;
  entityId: string | null;
  entityName: string;
  entityKey: "workforce" | "select" | "events";
  status: "not_started";
  steps: PipelineStep[];
  tasks: PipelineTask[];
  /** Always empty on recovery — recovery doesn't try to re-attach to assignments. */
  assignmentIds: never[];
  triggeredBy: {
    source: "admin_recovery_recreate";
    uid: string;
  };
  /** Audit marker so future ops can tell a recovery doc from an organic one. */
  recoveredAt: admin.firestore.FieldValue;
  recoveredBy: string;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
  version: 1;
}

/**
 * Build the `worker_onboarding/{userId}__{entityKey}` doc payload using
 * the same step/task/milestone shape as `ensureWorkerOnboardingPipeline`.
 * Pure function — safe to unit-test without Firestore.
 *
 * Differences from the canonical creator's payload:
 *   - `triggeredBy.source = 'admin_recovery_recreate'` so audit can tell.
 *   - Adds `recoveredAt` / `recoveredBy` audit fields.
 *   - Forces `status: 'not_started'` and `assignmentIds: []` — recovery
 *     can't reconstruct partial progress; the worker resumes through
 *     the iframe + lifecycle triggers like a fresh hire would.
 */
export function buildWorkerOnboardingRecoveryDoc(
  input: BuildWorkerOnboardingRecoveryDocInput,
): WorkerOnboardingRecoveryDoc {
  const steps: PipelineStep[] = PIPELINE_STEPS.map((step) => {
    const defs = STEP_MILESTONES[step.id];
    const milestones = defs
      ? defs.map((m) => ({ id: m.id, label: m.label, completed: false }))
      : undefined;
    const base: PipelineStep = {
      id: step.id,
      title: step.title,
      status: "not_started",
      applicability: computeStepApplicability(input.entityData, step.id),
      updatedAt: input.nestedTimestamp,
      updatedBy: input.triggeredByUid,
    };
    return milestones?.length ? { ...base, milestones } : base;
  });
  const tasks = buildInitialTasks();
  return {
    tenantId: input.tenantId,
    userId: input.userId,
    userName: input.userName,
    entityId: input.entityId,
    entityName: input.entityName,
    entityKey: input.entityKey,
    status: "not_started",
    steps,
    tasks,
    assignmentIds: [] as never[],
    triggeredBy: {
      source: "admin_recovery_recreate",
      uid: input.triggeredByUid,
    },
    recoveredAt: input.serverTimestamp,
    recoveredBy: input.triggeredByUid,
    createdAt: input.serverTimestamp,
    updatedAt: input.serverTimestamp,
    version: 1,
  };
}

export interface BuildEvereeWorkerLinkageRecoveryDocInput {
  tenantId: string;
  entityId: string;
  userId: string;
  /** Same as `userId` for HRX workers — `users/{uid}` doc id is the Firebase Auth uid. */
  firebaseUid: string;
  /** Authoritative source: `users.evereeWorkerIds[evereeTenantId]`. */
  evereeWorkerId: string;
  evereeTenantId: string;
  /** From entity doc (`workerType` field), normalized to `'employee' | 'contractor'`. */
  workerType: "employee" | "contractor";
  triggeredByUid: string;
  serverTimestamp: admin.firestore.FieldValue;
}

export interface EvereeWorkerLinkageRecoveryDoc {
  tenantId: string;
  entityId: string;
  userId: string;
  firebaseUid: string;
  externalWorkerId: string;
  evereeTenantId: string;
  evereeWorkerId: string;
  workerType: "employee" | "contractor";
  /** Recovery never claims onboarding state — webhook owns `onboarding_complete`. */
  status: "created";
  recoveredAt: admin.firestore.FieldValue;
  recoveredBy: string;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

/**
 * Build the `everee_workers/{entityId}__{userId}` linkage doc payload —
 * mirrors the shape `createWorkerIfNeeded` writes after a successful
 * Everee POST, minus any onboarding-status fields. Pure function.
 *
 * Note `status: 'created'` — never `'onboarding_complete'`. The webhook
 * (`evereeWebhook.ts`) is the only writer that should flip onboarding
 * status; recovery deliberately leaves that field at the neutral default
 * even if the worker is in fact already complete on Everee's side. The
 * next `evereeAdminGetWorker` API call (or webhook event) will rehydrate
 * the canonical state.
 */
export function buildEvereeWorkerLinkageRecoveryDoc(
  input: BuildEvereeWorkerLinkageRecoveryDocInput,
): EvereeWorkerLinkageRecoveryDoc {
  return {
    tenantId: input.tenantId,
    entityId: input.entityId,
    userId: input.userId,
    firebaseUid: input.firebaseUid,
    externalWorkerId: input.evereeWorkerId,
    evereeTenantId: input.evereeTenantId,
    evereeWorkerId: input.evereeWorkerId,
    workerType: input.workerType,
    status: "created",
    recoveredAt: input.serverTimestamp,
    recoveredBy: input.triggeredByUid,
    createdAt: input.serverTimestamp,
    updatedAt: input.serverTimestamp,
  };
}

export interface EvereeAdminRecreateWorkerOnboardingResult {
  ok: true;
  pipelineId: string;
  linkageDocId: string;
  /** Whether the worker_onboarding doc was actually written (false = already existed). */
  workerOnboardingRecreated: boolean;
  /** Whether the everee_workers linkage doc was actually written. */
  evereeWorkersLinkageRecreated: boolean;
  /** Resolved entity context (helpful for the UI toast). */
  entityKey: "workforce" | "select" | "events";
  entityName: string;
  /** Resolved Everee worker id, if a linkage was created or already present. */
  evereeWorkerId: string | null;
  evereeTenantId: string | null;
}

export const evereeAdminRecreateWorkerOnboarding = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign-in required");
  }
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === "string" ? d.tenantId.trim() : "";
  const entityId = typeof d?.entityId === "string" ? d.entityId.trim() : "";
  const userId = typeof d?.userId === "string" ? d.userId.trim() : "";
  if (!tenantId || !entityId || !userId) {
    throw new HttpsError(
      "invalid-argument",
      "tenantId, entityId, userId are required",
    );
  }
  if (!(await canManageEveree(request.auth as any, tenantId))) {
    throw new HttpsError(
      "permission-denied",
      "Not allowed to recreate Everee onboarding records for this tenant",
    );
  }

  const db = admin.firestore();
  const entityContext = await resolveEntityContext({ tenantId, entityId });
  if (!entityContext.entityId) {
    throw new HttpsError(
      "not-found",
      `Entity ${entityId} does not exist in tenant ${tenantId}`,
    );
  }
  const pipelineId = `${userId}__${entityContext.entityKey}`;
  const linkageDocId = `${entityContext.entityId}__${userId}`;

  // Recovery anchor: refuse if the worker has no employment with this
  // entity. We don't want to materialize onboarding for someone who was
  // never actually hired here; that's a different (worse) bug.
  const employmentRef = db.doc(
    `tenants/${tenantId}/entity_employments/${pipelineId}`,
  );
  const employmentSnap = await employmentRef.get();
  if (!employmentSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      `entity_employments/${pipelineId} is missing — recreate the employment first; recovery only restores the onboarding scaffold + Everee linkage on top of an existing employment.`,
    );
  }

  // Resolve user identity for `userName` field. Mirrors what the canonical
  // creator stores so deferred consumers (analytics, audit exports) don't
  // see schema drift between organic vs recovered docs.
  const userSnap = await db.doc(`users/${userId}`).get();
  if (!userSnap.exists) {
    throw new HttpsError(
      "not-found",
      `users/${userId} does not exist`,
    );
  }
  const userData = (userSnap.data() ?? {}) as {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    evereeWorkerIds?: Record<string, string>;
  };
  const userName = String(
    userData.displayName ||
      [userData.firstName, userData.lastName].filter(Boolean).join(" ").trim() ||
      userData.email ||
      userId,
  );

  // Resolve worker type for the linkage doc from entity config — we don't
  // want recovery to flip `'employee'` ↔ `'contractor'`, so derive it from
  // the same `entities/{eid}.workerType` the canonical creator reads.
  const entityWorkerTypeRaw = String(
    entityContext.entityData?.workerType ?? "W2",
  )
    .trim()
    .toUpperCase();
  const workerType: "employee" | "contractor" =
    entityWorkerTypeRaw === "1099" ? "contractor" : "employee";

  // Resolve the Everee worker id from the user-record map. The entity doc
  // tells us which Everee tenant id this entity is wired to; the user
  // doc tells us the worker id under that Everee tenant (mirrored by
  // `createWorkerIfNeeded`). If the user-map entry is missing, we can
  // still recover the worker_onboarding doc but can't recover the linkage
  // — that's an acceptable degraded mode (the alternative is doing
  // nothing, which leaves both docs missing).
  const entitySnap = await db
    .doc(`tenants/${tenantId}/entities/${entityContext.entityId}`)
    .get();
  const entityDoc = (entitySnap.data() ?? {}) as {
    evereeTenantId?: string | number | null;
    evereeEnabled?: boolean;
  };
  const evereeTenantIdRaw = entityDoc.evereeTenantId;
  const evereeTenantId =
    evereeTenantIdRaw == null
      ? null
      : String(evereeTenantIdRaw).trim() || null;
  const userEvereeWorkerIds = userData.evereeWorkerIds ?? {};
  const evereeWorkerIdFromUserMap = evereeTenantId
    ? String(userEvereeWorkerIds[evereeTenantId] ?? "").trim() || null
    : null;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const nestedTs = timestampForNestedDoc();

  // 1. worker_onboarding recovery — idempotent on the doc id.
  const pipelineRef = db.doc(
    `tenants/${tenantId}/worker_onboarding/${pipelineId}`,
  );
  const pipelineSnap = await pipelineRef.get();
  let workerOnboardingRecreated = false;
  if (!pipelineSnap.exists) {
    const recoveryDoc = buildWorkerOnboardingRecoveryDoc({
      tenantId,
      userId,
      userName,
      entityId: entityContext.entityId,
      entityName: entityContext.entityName,
      entityKey: entityContext.entityKey,
      entityData: entityContext.entityData,
      triggeredByUid: request.auth.uid,
      nestedTimestamp: nestedTs,
      serverTimestamp: now,
    });
    await pipelineRef.create(recoveryDoc);
    workerOnboardingRecreated = true;
  }

  // 2. everee_workers linkage recovery — only when we have a worker id
  //    to write. Skip silently when the user-map is missing the entry —
  //    surfaced in the response so the CSA UI can show "linkage not
  //    recovered: missing user-map entry; click Re-sync to Everee first".
  const linkageRef = db.doc(
    `tenants/${tenantId}/everee_workers/${linkageDocId}`,
  );
  const linkageSnap = await linkageRef.get();
  let evereeWorkersLinkageRecreated = false;
  if (
    !linkageSnap.exists &&
    evereeTenantId &&
    evereeWorkerIdFromUserMap &&
    entityDoc.evereeEnabled === true
  ) {
    const linkageDoc = buildEvereeWorkerLinkageRecoveryDoc({
      tenantId,
      entityId: entityContext.entityId,
      userId,
      firebaseUid: userId,
      evereeWorkerId: evereeWorkerIdFromUserMap,
      evereeTenantId,
      workerType,
      triggeredByUid: request.auth.uid,
      serverTimestamp: now,
    });
    await linkageRef.create(linkageDoc);
    evereeWorkersLinkageRecreated = true;
  }

  logger.info("[evereeAdminRecreateWorkerOnboarding] complete", {
    tenantId,
    entityId: entityContext.entityId,
    userId,
    pipelineId,
    linkageDocId,
    workerOnboardingRecreated,
    evereeWorkersLinkageRecreated,
    evereeWorkerIdFromUserMap,
    callerUid: request.auth.uid,
  });

  const result: EvereeAdminRecreateWorkerOnboardingResult = {
    ok: true,
    pipelineId,
    linkageDocId,
    workerOnboardingRecreated,
    evereeWorkersLinkageRecreated,
    entityKey: entityContext.entityKey,
    entityName: entityContext.entityName,
    evereeWorkerId: evereeWorkerIdFromUserMap,
    evereeTenantId,
  };
  return result;
});
