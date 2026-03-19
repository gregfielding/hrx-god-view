import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type PipelineStepId =
  | "i9"
  | "onboarding_forms"
  | "everee"
  | "e_verify"
  | "background_check"
  | "drug_screen";

type StepStatus = "not_started" | "in_progress" | "complete" | "blocked";
type StepWorkflowStatus =
  | "not_started"
  | "pending_package"
  | "package_selected"
  | "ordered"
  | "awaiting_worker"
  | "scheduled"
  | "in_progress"
  | "complete"
  | "blocked"
  | "skipped"
  | "failed"
  | "canceled";
type StepApplicability = "required" | "not_required" | "pending";
type TaskOwner = "worker" | "recruiter";
type TaskStatus = "pending" | "in_progress" | "complete";

interface StepMilestone {
  id: string;
  label: string;
  completed: boolean;
  completedAt?: admin.firestore.Timestamp;
  completedBy?: string;
}

interface PipelineStep {
  id: PipelineStepId;
  title: string;
  status: StepStatus;
  applicability?: StepApplicability;
  selectedPackageId?: string;
  selectedPackageLabel?: string;
  workflowStatus?: StepWorkflowStatus;
  orderedAt?: admin.firestore.Timestamp;
  skippedAt?: admin.firestore.Timestamp;
  completedAt?: admin.firestore.Timestamp;
  failureReason?: string;
  note?: string;
  milestones?: StepMilestone[];
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedBy: string;
}

interface PipelineTask {
  id: string;
  stepId: PipelineStepId;
  owner: TaskOwner;
  title: string;
  status: TaskStatus;
}

function canManageOnboardingFromClaims(auth: any, tenantId: string): boolean {
  const roles = auth?.token?.roles || {};
  const tenantRole = roles?.[tenantId]?.role;
  if (tenantRole && ["Recruiter", "Manager", "Admin"].includes(String(tenantRole))) return true;
  if (auth?.token?.isHRX === true) return true;
  return false;
}

async function canManageOnboarding(auth: any, tenantId: string, uid: string): Promise<boolean> {
  if (canManageOnboardingFromClaims(auth, tenantId)) return true;
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) return false;
  const userData: any = userSnap.data() || {};
  const tenantMeta = userData?.tenantIds?.[tenantId] || {};
  const role = String(tenantMeta.role || userData.role || "").trim().toLowerCase();
  if (["recruiter", "manager", "admin"].includes(role)) return true;
  const secRaw = tenantMeta.securityLevel ?? userData.securityLevel ?? "0";
  const sec = parseInt(String(secRaw), 10);
  return !Number.isNaN(sec) && sec >= 4;
}

/** Onboarding pipeline: compliance-only. Steps = required to legally employ or pay a worker. No emergency contact (profile) or benefits (separate module). */
const PIPELINE_STEPS: Array<{ id: PipelineStepId; title: string }> = [
  { id: "i9", title: "I-9" },
  { id: "onboarding_forms", title: "Onboarding forms (TempWorks)" },
  { id: "everee", title: "Payroll Setup" },
  { id: "e_verify", title: "E-Verify" },
  { id: "background_check", title: "Background check" },
  { id: "drug_screen", title: "Drug screen" },
];

/** Default admin checklist milestones per step (compliance-only; includes payroll/direct deposit, not emergency contact or benefits). */
const STEP_MILESTONES: Partial<Record<PipelineStepId, Array<{ id: string; label: string }>>> = {
  i9: [{ id: "i9_sent", label: "I-9 sent" }, { id: "i9_completed", label: "I-9 completed" }],
  onboarding_forms: [
    { id: "handbook_sent", label: "Handbook / manual sent" },
    { id: "handbook_signed", label: "Handbook / manual signed" },
    { id: "tax_forms", label: "Tax forms" },
    { id: "contractor_agreement_sent", label: "Contractor agreement sent" },
    { id: "contractor_agreement_signed", label: "Contractor agreement signed" },
    { id: "payroll_setup", label: "Payroll setup" },
    { id: "direct_deposit", label: "Direct deposit" },
  ],
  everee: [
    { id: "everee_invite_sent", label: "Payroll invite sent" },
    { id: "payroll_account_created", label: "Payroll account created" },
    { id: "everee_setup_complete", label: "Payroll setup complete" },
  ],
};

function buildInitialTasks(): PipelineTask[] {
  return [
    { id: "worker_i9", stepId: "i9", owner: "worker", title: "Complete I-9 information", status: "pending" },
    { id: "worker_forms", stepId: "onboarding_forms", owner: "worker", title: "Complete TempWorks onboarding forms", status: "pending" },
    { id: "worker_drug_screen", stepId: "drug_screen", owner: "worker", title: "Complete drug test requirement", status: "pending" },
    { id: "recruiter_i9_verify", stepId: "i9", owner: "recruiter", title: "Verify I-9 completion", status: "pending" },
    { id: "recruiter_background_review", stepId: "background_check", owner: "recruiter", title: "Review background check status", status: "pending" },
    { id: "recruiter_finalize", stepId: "onboarding_forms", owner: "recruiter", title: "Review and complete onboarding packet", status: "pending" },
  ];
}

function deriveEntityKeyFromName(rawName: string): "workforce" | "select" | "events" {
  const v = String(rawName || "").toLowerCase();
  if (v.includes("select")) return "select";
  if (v.includes("event")) return "events";
  return "workforce";
}

async function resolveEntityContext(args: {
  tenantId: string;
  entityId?: string | null;
  jobOrderId?: string | null;
}): Promise<{
  entityId: string | null;
  entityName: string;
  entityKey: "workforce" | "select" | "events";
  entityData?: { onboardingWorkflowSteps?: Record<string, boolean>; workerType?: string; everifyRequired?: boolean };
}> {
  const { tenantId, entityId, jobOrderId } = args;
  let resolvedEntityId = entityId || null;

  if (!resolvedEntityId && jobOrderId) {
    const jobOrderSnap = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
    if (jobOrderSnap.exists) {
      const jo = jobOrderSnap.data() || {};
      resolvedEntityId = (jo.entityId as string) || null;
    }
  }

  if (!resolvedEntityId) {
    return {
      entityId: null,
      entityName: "C1 Workforce LLC",
      entityKey: "workforce",
    };
  }

  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${resolvedEntityId}`).get();
  const entity = entitySnap.exists ? entitySnap.data() || {} : {};
  const entityName = String(entity.name || entity.legalName || entity.title || "C1 Workforce LLC");
  return {
    entityId: resolvedEntityId,
    entityName,
    entityKey: deriveEntityKeyFromName(entityName),
    entityData: {
      onboardingWorkflowSteps: (entity.onboardingWorkflowSteps as Record<string, boolean>) || {},
      workerType: entity.workerType as string | undefined,
      everifyRequired: Boolean(entity.everifyRequired),
    },
  };
}

/** Map entity onboardingWorkflowSteps + workerType + everifyRequired to applicability for each canonical step. */
function computeStepApplicability(
  entityData: { onboardingWorkflowSteps?: Record<string, boolean>; workerType?: string; everifyRequired?: boolean } | undefined,
  stepId: PipelineStepId
): StepApplicability {
  const steps = entityData?.onboardingWorkflowSteps || {};
  const workerType = String(entityData?.workerType || "W2").toUpperCase();
  const everifyRequired = Boolean(entityData?.everifyRequired);

  const checked = (id: string) => !!steps[id];

  switch (stepId) {
    case "i9": {
      const anyI9 = checked("i9_sent") || checked("i9_completed");
      if (anyI9) return "required";
      if (workerType === "1099") return "not_required";
      return "pending";
    }
    case "onboarding_forms": {
      // Compliance-only: exclude emergency_contact (profile) and benefits_enrollment (separate module)
      const anyForm =
        checked("handbook_sent") || checked("handbook_signed") || checked("w4_sent") || checked("w4_completed") ||
        checked("policy_acknowledgments") || checked("ic_agreement_sent") || checked("ic_agreement_signed") ||
        checked("1099_sent") || checked("1099_completed") || checked("w9_received") ||
        checked("direct_deposit_contractor") || checked("direct_deposit_w2");
      return anyForm ? "required" : "not_required";
    }
    case "everee": {
      const anyEveree = checked("payroll_invite_sent") || checked("payroll_setup_complete");
      return anyEveree ? "required" : "not_required";
    }
    case "e_verify": {
      const anyEverify = checked("everify_sent") || checked("everify_completed");
      if (everifyRequired || anyEverify) return "required";
      if (workerType === "1099") return "not_required";
      return "pending";
    }
    case "background_check": {
      const anyBg = checked("background_initiated") || checked("background_completed");
      return anyBg ? "required" : "not_required";
    }
    case "drug_screen": {
      if (workerType === "1099") return "not_required";
      return "pending";
    }
    default:
      return "required";
  }
}

function computePipelineStatus(steps: PipelineStep[]): "not_started" | "in_progress" | "complete" {
  const allNotStarted = steps.every((s) => s.status === "not_started");
  if (allNotStarted) return "not_started";
  const allComplete = steps.every((s) => s.status === "complete");
  if (allComplete) return "complete";
  return "in_progress";
}

/** E-Verify case status → pipeline step status / employment everifyStatus. */
function mapEverifyCaseStatusToStepStatus(
  caseStatus: string
): StepStatus {
  const s = String(caseStatus || "").toLowerCase();
  if (s === "employment_authorized" || s === "closed") return "complete";
  if (s === "error" || s === "final_nonconfirmation") return "blocked";
  if (s === "draft" || s === "ready") return "not_started";
  return "in_progress";
}

/**
 * Sync E-Verify case status to worker_onboarding e_verify step and entity_employments.everifyStatus.
 * Call from E-Verify triggers when case status changes.
 */
export async function syncEverifyStatusToPipelineAndEmployment(args: {
  tenantId: string;
  userId: string | null;
  entityId: string | null;
  caseStatus: string;
}): Promise<void> {
  const { tenantId, userId, entityId, caseStatus } = args;
  if (!userId) return;
  let entityKey: "workforce" | "select" | "events" = "workforce";
  if (entityId) {
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    const entity = entitySnap.exists ? entitySnap.data() || {} : {};
    entityKey = deriveEntityKeyFromName(String(entity.name || entity.legalName || ""));
  }
  const pipelineId = `${userId}__${entityKey}`;
  const pipelineRef = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const employmentRef = db.doc(`tenants/${tenantId}/entity_employments/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const stepStatus = mapEverifyCaseStatusToStepStatus(caseStatus);

  const pipelineSnap = await pipelineRef.get();
  if (pipelineSnap.exists) {
    const data = pipelineSnap.data() || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const nextSteps: PipelineStep[] = steps.map((step: any) =>
      step.id === "e_verify"
        ? { ...step, status: stepStatus, updatedAt: now, updatedBy: "everify_sync" }
        : step
    );
    const pipelineStatus = computePipelineStatus(nextSteps);
    await pipelineRef.set(
      { steps: nextSteps, status: pipelineStatus, updatedAt: now, lastUpdatedBy: "everify_sync" },
      { merge: true }
    );
  }

  await employmentRef.set(
    { everifyStatus: caseStatus, updatedAt: now },
    { merge: true }
  );
}

export async function ensureWorkerOnboardingPipeline(args: {
  tenantId: string;
  userId: string;
  assignmentId?: string | null;
  jobOrderId?: string | null;
  entityId?: string | null;
  triggeredByUid: string;
  triggerSource: "worker_confirmation" | "recruiter_confirmation" | "manual";
}): Promise<{ pipelineId: string; created: boolean }> {
  const { tenantId, userId, assignmentId, jobOrderId, entityId, triggeredByUid, triggerSource } = args;
  const entityContext = await resolveEntityContext({ tenantId, entityId, jobOrderId });
  const pipelineId = `${userId}__${entityContext.entityKey}`;
  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const employmentRef = db.doc(`tenants/${tenantId}/entity_employments/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const userSnap = await db.doc(`users/${userId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const userName = String(
    userData.displayName ||
      [userData.firstName, userData.lastName].filter(Boolean).join(" ").trim() ||
      userData.email ||
      userId
  );

  const workerTypeForEmployment = (entityContext.entityData?.workerType === "1099" ? "1099" : "w2") as "w2" | "1099";
  const everifyRequired = entityContext.entityData?.everifyRequired ?? false;
  const bgRequired = computeStepApplicability(entityContext.entityData, "background_check") === "required";
  const drugRequired = computeStepApplicability(entityContext.entityData, "drug_screen") !== "not_required";

  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const employmentSnap = await tx.get(employmentRef);
    const isFirstEmployment = !employmentSnap.exists;

    if (!snap.exists) {
      const steps: PipelineStep[] = PIPELINE_STEPS.map((step) => {
        const defs = STEP_MILESTONES[step.id];
        const milestones: StepMilestone[] = defs
          ? defs.map((m) => ({ id: m.id, label: m.label, completed: false }))
          : undefined as any;
        return {
          id: step.id,
          title: step.title,
          status: "not_started",
          applicability: computeStepApplicability(entityContext.entityData, step.id),
          milestones: milestones?.length ? milestones : undefined,
          updatedAt: now,
          updatedBy: triggeredByUid,
        };
      });
      const tasks = buildInitialTasks();
      tx.set(ref, {
        tenantId,
        userId,
        userName,
        entityId: entityContext.entityId,
        entityName: entityContext.entityName,
        entityKey: entityContext.entityKey,
        status: "not_started",
        steps,
        tasks,
        assignmentIds: assignmentId ? [assignmentId] : [],
        triggeredBy: {
          source: triggerSource,
          uid: triggeredByUid,
        },
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    } else {
      const existing = snap.data() || {};
      const existingAssignmentIds = Array.isArray(existing.assignmentIds) ? existing.assignmentIds : [];
      const nextAssignmentIds = assignmentId
        ? Array.from(new Set([...existingAssignmentIds, assignmentId]))
        : existingAssignmentIds;
      tx.set(
        ref,
        {
          assignmentIds: nextAssignmentIds,
          updatedAt: now,
          lastTrigger: {
            source: triggerSource,
            uid: triggeredByUid,
            at: now,
          },
        },
        { merge: true }
      );
    }

    const employmentPayload: Record<string, unknown> = {
      tenantId,
      userId,
      entityId: entityContext.entityId ?? null,
      entityKey: entityContext.entityKey,
      entityName: entityContext.entityName,
      workerType: workerTypeForEmployment,
      status: "onboarding",
      onboardingPipelineId: pipelineId,
      sourceAssignmentId: assignmentId ?? null,
      sourceJobOrderId: jobOrderId ?? null,
      everifyRequired,
      backgroundRequired: bgRequired,
      drugScreenRequired: drugRequired,
      active: false,
      updatedAt: now,
    };
    if (isFirstEmployment) {
      employmentPayload.onboardingStartedAt = now;
      employmentPayload.createdAt = now;
    }
    tx.set(employmentRef, employmentPayload, { merge: true });

    return !snap.exists;
  });

  return { pipelineId, created };
}

export const triggerWorkerOnboardingPipeline = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, userId, entityId = null, jobOrderId = null, assignmentId = null } = (request.data || {}) as {
    tenantId?: string;
    userId?: string;
    entityId?: string | null;
    jobOrderId?: string | null;
    assignmentId?: string | null;
  };

  if (!tenantId || !userId) {
    throw new HttpsError("invalid-argument", "tenantId and userId are required");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to trigger onboarding");
  }

  const result = await ensureWorkerOnboardingPipeline({
    tenantId,
    userId,
    entityId,
    jobOrderId,
    assignmentId,
    triggeredByUid: request.auth.uid,
    triggerSource: "manual",
  });

  return { success: true, ...result };
});

export const updateWorkerOnboardingStepStatus = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, pipelineId, stepId, status } = (request.data || {}) as {
    tenantId?: string;
    pipelineId?: string;
    stepId?: PipelineStepId;
    status?: StepStatus;
  };

  if (!tenantId || !pipelineId || !stepId || !status) {
    throw new HttpsError("invalid-argument", "tenantId, pipelineId, stepId, and status are required");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to update onboarding");
  }

  const validStatuses: StepStatus[] = ["not_started", "in_progress", "complete", "blocked"];
  if (!validStatuses.includes(status)) {
    throw new HttpsError("invalid-argument", "Invalid step status");
  }

  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Onboarding pipeline not found");
    }
    const data = snap.data() || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];

    const nextSteps: PipelineStep[] = steps.map((step: any) =>
      step.id === stepId
        ? {
            ...step,
            status,
            updatedAt: now,
            updatedBy: request.auth!.uid,
          }
        : step
    );

    const mappedTaskStatus: TaskStatus =
      status === "complete" ? "complete" : status === "in_progress" ? "in_progress" : "pending";
    const nextTasks: PipelineTask[] = tasks.map((task: any) =>
      task.stepId === stepId ? { ...task, status: mappedTaskStatus } : task
    );

    const pipelineStatus = computePipelineStatus(nextSteps);

    tx.set(
      ref,
      {
        steps: nextSteps,
        tasks: nextTasks,
        status: pipelineStatus,
        updatedAt: now,
        lastUpdatedBy: request.auth.uid,
      },
      { merge: true }
    );
  });

  return { success: true };
});

/** Dummy package options for Phase 1 (background / drug screen). */
export const DUMMY_BACKGROUND_PACKAGES = [
  { id: "dummy_bg_1", label: "Dummy Background 1" },
  { id: "dummy_bg_2", label: "Dummy Background 2" },
];
export const DUMMY_DRUG_PACKAGES = [
  { id: "dummy_drug_1", label: "Dummy Drug 1" },
  { id: "dummy_drug_2", label: "Dummy Drug 2" },
];

export const updateWorkerOnboardingStepPackage = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, pipelineId, stepId, packageId, packageLabel } = (request.data || {}) as {
    tenantId?: string;
    pipelineId?: string;
    stepId?: PipelineStepId;
    packageId?: string | null;
    packageLabel?: string | null;
  };

  if (!tenantId || !pipelineId || !stepId) {
    throw new HttpsError("invalid-argument", "tenantId, pipelineId, and stepId are required");
  }
  if (stepId !== "background_check" && stepId !== "drug_screen") {
    throw new HttpsError("invalid-argument", "Only background_check and drug_screen steps support package selection");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to update onboarding");
  }

  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Onboarding pipeline not found");
    }
    const data = snap.data() || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const nextSteps: PipelineStep[] = steps.map((step: any) => {
      if (step.id !== stepId) return step;
      const hasPackage = !!packageId && !!packageLabel;
      return {
        ...step,
        selectedPackageId: packageId ?? undefined,
        selectedPackageLabel: packageLabel ?? undefined,
        workflowStatus: hasPackage ? "package_selected" : (step.workflowStatus ?? "pending_package"),
        status: hasPackage ? "in_progress" : step.status,
        updatedAt: now,
        updatedBy: request.auth!.uid,
      };
    });
    const pipelineStatus = computePipelineStatus(nextSteps);
    tx.set(ref, { steps: nextSteps, status: pipelineStatus, updatedAt: now, lastUpdatedBy: request.auth.uid }, { merge: true });
  });

  return { success: true };
});

/** Map workflowStatus to display status for pipeline progress. */
function workflowStatusToStepStatus(workflowStatus: StepWorkflowStatus): StepStatus {
  if (workflowStatus === "complete") return "complete";
  if (["skipped", "blocked", "failed", "canceled"].includes(workflowStatus)) return "blocked";
  if (["ordered", "awaiting_worker", "scheduled", "in_progress", "package_selected"].includes(workflowStatus)) return "in_progress";
  return "not_started";
}

export const updateWorkerOnboardingStepWorkflow = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, pipelineId, stepId, workflowStatus, note, failureReason } = (request.data || {}) as {
    tenantId?: string;
    pipelineId?: string;
    stepId?: PipelineStepId;
    workflowStatus?: StepWorkflowStatus;
    note?: string | null;
    failureReason?: string | null;
  };

  if (!tenantId || !pipelineId || !stepId || !workflowStatus) {
    throw new HttpsError("invalid-argument", "tenantId, pipelineId, stepId, and workflowStatus are required");
  }
  const valid: StepWorkflowStatus[] = [
    "not_started", "pending_package", "package_selected", "ordered", "awaiting_worker",
    "scheduled", "in_progress", "complete", "blocked", "skipped", "failed", "canceled",
  ];
  if (!valid.includes(workflowStatus)) {
    throw new HttpsError("invalid-argument", "Invalid workflowStatus");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to update onboarding");
  }

  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const uid = request.auth.uid;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Onboarding pipeline not found");
    }
    const data = snap.data() || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const nextSteps: PipelineStep[] = steps.map((step: any) => {
      if (step.id !== stepId) return step;
      const updates: any = {
        ...step,
        workflowStatus,
        status: workflowStatusToStepStatus(workflowStatus),
        updatedAt: now,
        updatedBy: uid,
      };
      if (note !== undefined) updates.note = note ?? undefined;
      if (failureReason !== undefined) updates.failureReason = failureReason ?? undefined;
      if (workflowStatus === "ordered") updates.orderedAt = now;
      if (workflowStatus === "skipped" || workflowStatus === "canceled") updates.skippedAt = now;
      if (workflowStatus === "complete") updates.completedAt = now;
      return updates;
    });
    const pipelineStatus = computePipelineStatus(nextSteps);
    tx.set(ref, { steps: nextSteps, status: pipelineStatus, updatedAt: now, lastUpdatedBy: uid }, { merge: true });
  });

  return { success: true };
});

export const updateWorkerOnboardingStepMilestone = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, pipelineId, stepId, milestoneId, completed } = (request.data || {}) as {
    tenantId?: string;
    pipelineId?: string;
    stepId?: PipelineStepId;
    milestoneId?: string;
    completed?: boolean;
  };

  if (!tenantId || !pipelineId || !stepId || !milestoneId) {
    throw new HttpsError("invalid-argument", "tenantId, pipelineId, stepId, and milestoneId are required");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to update onboarding");
  }

  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const uid = request.auth.uid;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Onboarding pipeline not found");
    }
    const data = snap.data() || {};
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const nextSteps: PipelineStep[] = steps.map((step: any) => {
      if (step.id !== stepId || !Array.isArray(step.milestones)) return step;
      const milestones = step.milestones.map((m: any) =>
        m.id === milestoneId
          ? {
              ...m,
              completed: completed ?? !m.completed,
              ...(completed ? { completedAt: now, completedBy: uid } : { completedAt: undefined, completedBy: undefined }),
            }
          : m
      );
      return { ...step, milestones, updatedAt: now, updatedBy: uid };
    });
    tx.set(ref, { steps: nextSteps, updatedAt: now, lastUpdatedBy: uid }, { merge: true });
  });

  return { success: true };
});

export type EntityEmploymentStatus = "onboarding" | "active" | "inactive" | "terminated";

export const updateEntityEmploymentStatus = onCall({ cors: true }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const { tenantId, employmentId, status, terminationReason } = (request.data || {}) as {
    tenantId?: string;
    employmentId?: string;
    status?: EntityEmploymentStatus;
    terminationReason?: string | null;
  };

  if (!tenantId || !employmentId || !status) {
    throw new HttpsError("invalid-argument", "tenantId, employmentId, and status are required");
  }
  const valid: EntityEmploymentStatus[] = ["onboarding", "active", "inactive", "terminated"];
  if (!valid.includes(status)) {
    throw new HttpsError("invalid-argument", "Invalid employment status");
  }
  if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to update employment status");
  }

  const ref = db.doc(`tenants/${tenantId}/entity_employments/${employmentId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const updates: Record<string, unknown> = {
    status,
    active: status === "active",
    updatedAt: now,
  };
  if (status === "terminated" || status === "inactive") {
    updates.terminatedAt = now;
    if (terminationReason) updates.terminationReason = terminationReason;
  }
  if (status === "active") {
    updates.hiredAt = now;
    updates.onboardingCompletedAt = now;
  }

  await ref.set(updates, { merge: true });
  return { success: true };
});
