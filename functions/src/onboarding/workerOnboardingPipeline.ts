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
type TaskOwner = "worker" | "recruiter";
type TaskStatus = "pending" | "in_progress" | "complete";

interface PipelineStep {
  id: PipelineStepId;
  title: string;
  status: StepStatus;
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

const PIPELINE_STEPS: Array<{ id: PipelineStepId; title: string }> = [
  { id: "i9", title: "I-9" },
  { id: "onboarding_forms", title: "Onboarding forms (TempWorks)" },
  { id: "everee", title: "Everee setup" },
  { id: "e_verify", title: "E-Verify" },
  { id: "background_check", title: "Background check" },
  { id: "drug_screen", title: "Drug screen" },
];

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
}): Promise<{ entityId: string | null; entityName: string; entityKey: "workforce" | "select" | "events" }> {
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
  };
}

function computePipelineStatus(steps: PipelineStep[]): "not_started" | "in_progress" | "complete" {
  const allNotStarted = steps.every((s) => s.status === "not_started");
  if (allNotStarted) return "not_started";
  const allComplete = steps.every((s) => s.status === "complete");
  if (allComplete) return "complete";
  return "in_progress";
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
  const scopeId = entityContext.entityId || entityContext.entityKey;
  const pipelineId = `${userId}__${scopeId}`;
  const ref = db.doc(`tenants/${tenantId}/worker_onboarding/${pipelineId}`);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const userSnap = await db.doc(`users/${userId}`).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const userName = String(
    userData.displayName ||
      [userData.firstName, userData.lastName].filter(Boolean).join(" ").trim() ||
      userData.email ||
      userId
  );

  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const steps: PipelineStep[] = PIPELINE_STEPS.map((step) => ({
        id: step.id,
        title: step.title,
        status: "not_started",
        updatedAt: now,
        updatedBy: triggeredByUid,
      }));
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
      return true;
    }

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
    return false;
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
