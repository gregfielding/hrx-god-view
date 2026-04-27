/**
 * Idempotent default I-9 supporting document rows when a worker_onboarding pipeline is first created.
 * Same Firestore shape as createWorkerI9SupportingDocumentRequest; createdByUid marks system origin.
 */
import * as admin from "firebase-admin";
import { logger } from "firebase-functions/v2";

const db = admin.firestore();

/** Matches web `src/constants/i9SupportingDocumentUi.ts` values. */
export const AUTO_I9_DEFAULT_LIST_B_TYPE = "list_b_drivers_license";
export const AUTO_I9_DEFAULT_LIST_C_TYPE = "list_c_ssn_card";

export const SYSTEM_I9_REQUEST_ACTOR = "system:worker_onboarding_pipeline";

type StepApplicability = "required" | "not_required" | "pending";

function computeI9Applicability(entityData: {
  onboardingWorkflowSteps?: Record<string, boolean>;
  workerType?: string;
}): StepApplicability {
  const steps = entityData?.onboardingWorkflowSteps || {};
  const workerType = String(entityData?.workerType || "W2").toUpperCase();
  const checked = (id: string) => !!steps[id];
  const anyI9 = checked("i9_sent") || checked("i9_completed");
  if (anyI9) return "required";
  if (workerType === "1099") return "not_required";
  return "pending";
}

/**
 * v1: Auto-create when W-2-style employment and I-9 is not explicitly "not_required", and we have an entity id.
 * Includes pipeline "pending" I-9 (typical entity has not toggled i9_sent yet) so W2 hires still get rows.
 */
export function shouldAutoCreateI9SupportingRequests(args: {
  workerTypeForEmployment: "w2" | "1099";
  entityId: string | null | undefined;
  entityData: { onboardingWorkflowSteps?: Record<string, boolean>; workerType?: string } | undefined;
}): boolean {
  if (args.workerTypeForEmployment === "1099") return false;
  const eid = String(args.entityId || "").trim();
  if (!eid) return false;
  const app = computeI9Applicability(args.entityData || {});
  return app === "required" || app === "pending";
}

export type EnsureWorkerI9SupportingRequestsResult = {
  skipped: boolean;
  reason?: string;
  documentIds?: string[];
};

export async function ensureWorkerI9SupportingRequestsOnPipelineCreate(args: {
  tenantId: string;
  userId: string;
  pipelineId: string;
  entityId: string | null | undefined;
  /** Pipeline entity key: `events` = C1 Events LLC — skip auto I-9 rows (Select / Workforce only). */
  entityKey: string;
  workerTypeForEmployment: "w2" | "1099";
  entityData: { onboardingWorkflowSteps?: Record<string, boolean>; workerType?: string } | undefined;
  assignmentId?: string | null;
}): Promise<EnsureWorkerI9SupportingRequestsResult> {
  const { tenantId, userId, pipelineId, entityId, entityKey, workerTypeForEmployment, entityData, assignmentId } =
    args;

  if (String(entityKey || "").trim().toLowerCase() === "events") {
    return { skipped: true, reason: "c1_events_entity" };
  }

  if (
    !shouldAutoCreateI9SupportingRequests({
      workerTypeForEmployment,
      entityId,
      entityData,
    })
  ) {
    return { skipped: true, reason: "not_applicable" };
  }

  const eid = String(entityId || "").trim();
  const result = await ensureListBandCI9RowsForEntityIfEmpty({
    tenantId,
    userId,
    entityId: eid,
    createdByUid: SYSTEM_I9_REQUEST_ACTOR,
    assignmentId: assignmentId ?? null,
    logContext: { pipelineId, source: "worker_onboarding_pipeline" },
  });
  return result;
}

/**
 * Idempotent: create default List B + List C awaiting_upload rows for one entity if none exist yet.
 * Used by pipeline start and worker self-serve on entity employment page.
 */
export async function ensureListBandCI9RowsForEntityIfEmpty(args: {
  tenantId: string;
  userId: string;
  entityId: string;
  createdByUid: string;
  assignmentId?: string | null;
  logContext?: { pipelineId?: string; source: string };
}): Promise<EnsureWorkerI9SupportingRequestsResult> {
  const { tenantId, userId, entityId, createdByUid, assignmentId, logContext } = args;
  const eid = String(entityId || "").trim();
  if (!eid) {
    return { skipped: true, reason: "missing_entity_id" };
  }

  const col = db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`);
  const existing = await col.where("userId", "==", userId).get();
  const forEntity = existing.docs.filter((d) => String(d.data()?.requestedForEntityId || "").trim() === eid);
  if (forEntity.length > 0) {
    return { skipped: true, reason: "already_has_rows_for_entity" };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const requestedFromAssignmentId =
    typeof assignmentId === "string" && assignmentId.trim() ? assignmentId.trim() : undefined;

  const batch = db.batch();
  const ids: string[] = [];

  for (const documentType of [AUTO_I9_DEFAULT_LIST_B_TYPE, AUTO_I9_DEFAULT_LIST_C_TYPE]) {
    const docRef = col.doc();
    ids.push(docRef.id);
    batch.set(docRef, {
      tenantId,
      userId,
      documentType,
      status: "awaiting_upload",
      storagePath: "",
      uploadedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      retainUntil: null,
      createdByUid: createdByUid,
      createdAt: now,
      updatedAt: now,
      requestedForEntityId: eid,
      ...(requestedFromAssignmentId ? { requestedFromAssignmentId } : {}),
    });
  }

  await batch.commit();

  logger.info("i9_supporting_document.list_b_c_requests_created", {
    tenantId,
    userId,
    entityId: eid,
    documentIds: ids,
    source: logContext?.source,
    pipelineId: logContext?.pipelineId,
  });

  return { skipped: false, documentIds: ids };
}
