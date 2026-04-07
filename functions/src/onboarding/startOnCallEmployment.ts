/**
 * Pre-assignment / labor-pool hire: opens entity employment + worker_onboarding without an assignment.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import { canManageOnboarding, ensureWorkerOnboardingPipeline } from "./workerOnboardingPipeline";
import { dispatchOnCallEmploymentStarted } from "../messaging/onCallEmploymentDispatch";
import { runPayrollOnboardingInviteForOnCallEmployment } from "../messaging/payrollOnCallInvite";
import { writeOnboardingAutomationDispatchLog } from "../messaging/onboardingAutomationDispatchLog";
import {
  assertEntityAllowsOnCallPool,
  assertWorkerTenantMembership,
} from "./onCallOnboardingGuards";
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from "../messaging/twilioSecrets";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ON_CALL_AUDIT_V = "v1";

const onCallWithTwilioSms = {
  cors: true as const,
  secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
};

export interface StartOnCallEmploymentPayload {
  tenantId: string;
  userId: string;
  entityId: string;
  workerType?: "w2" | "1099" | "entity_default" | null;
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  note?: string | null;
}

type AuthForAccusource = { token?: Record<string, unknown> };

/**
 * Core flow (callable + future internal callers).
 */
export async function runStartOnCallEmploymentFlow(
  args: StartOnCallEmploymentPayload & {
    initiatedByUid: string;
    authForAccusource?: AuthForAccusource;
    /** When true (dedicated on-call onboarding entrypoint), require tenant membership for the worker and entity on-call eligibility. */
    enforceOnCallOnboardingPolicy?: boolean;
  }
): Promise<{
  pipelineId: string;
  created: boolean;
  entityKey: string;
  hiringEntityId: string;
  entityName: string;
}> {
  const {
    tenantId,
    userId,
    entityId,
    workerType: workerTypeRaw,
    screeningPackageId,
    screeningPackageName,
    note,
    initiatedByUid,
    authForAccusource,
    enforceOnCallOnboardingPolicy,
  } = args;

  const trimmedUser = String(userId || "").trim();
  const trimmedEntity = String(entityId || "").trim();
  if (!tenantId || !trimmedUser || !trimmedEntity) {
    throw new HttpsError("invalid-argument", "tenantId, userId, and entityId are required");
  }

  const entitySnap = await db.doc(`tenants/${tenantId}/entities/${trimmedEntity}`).get();
  if (!entitySnap.exists) {
    throw new HttpsError("not-found", "Hiring entity not found");
  }
  const entityDoc = entitySnap.data() || {};
  const entityName = String(entityDoc.name || entityDoc.legalName || entityDoc.title || trimmedEntity);

  if (enforceOnCallOnboardingPolicy) {
    assertEntityAllowsOnCallPool(entityDoc, trimmedEntity);
    await assertWorkerTenantMembership(db, tenantId, trimmedUser);
  }

  const workerTypeOverride =
    workerTypeRaw === "w2" || workerTypeRaw === "1099" ? workerTypeRaw : null;

  const pipelineResult = await ensureWorkerOnboardingPipeline({
    tenantId,
    userId: trimmedUser,
    entityId: trimmedEntity,
    assignmentId: null,
    jobOrderId: null,
    triggeredByUid: initiatedByUid,
    triggerSource: "on_call",
    employmentEntryMode: "on_call_pool",
    onCallNote: note ?? null,
    onCallScreeningPackageId: screeningPackageId ?? null,
    onCallScreeningPackageName: screeningPackageName ?? null,
    workerTypeOverride,
    suppressPipelineStartedAutomation: true,
  });

  const { pipelineId, created } = pipelineResult;
  const entityKey =
    pipelineId.startsWith(`${trimmedUser}__`) && pipelineId.length > trimmedUser.length + 2
      ? pipelineId.slice(trimmedUser.length + 2)
      : "workforce";

  await db.doc(`tenants/${tenantId}/entity_employments/${pipelineId}`).set(
    {
      onboardingPhase: "in_progress",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const auditKey = `on_call_employment_flow__${ON_CALL_AUDIT_V}__${tenantId}__${pipelineId}__${created ? "create" : "merge"}`;
  await writeOnboardingAutomationDispatchLog({
    tenantId,
    eventType: "on_call_employment_started",
    correlationKey: auditKey,
    assignmentId: "",
    userId: trimmedUser,
    outcome: "recorded",
    hiringEntityId: trimmedEntity,
    details: {
      pipelineId,
      created,
      entityKey,
      note: note ?? null,
      screeningPackageId: screeningPackageId ?? null,
    },
  });

  try {
    await dispatchOnCallEmploymentStarted({
      tenantId,
      userId: trimmedUser,
      pipelineId,
      hiringEntityId: trimmedEntity,
      entityName,
      entityKey,
      initiatedByUid,
    });
  } catch (e: unknown) {
    logger.warn("dispatchOnCallEmploymentStarted failed", {
      tenantId,
      pipelineId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  try {
    await runPayrollOnboardingInviteForOnCallEmployment({
      tenantId,
      userId: trimmedUser,
      hiringEntityId: trimmedEntity,
      contextLabel: "your on-call employment",
    });
  } catch (e: unknown) {
    logger.warn("runPayrollOnboardingInviteForOnCallEmployment failed", {
      tenantId,
      pipelineId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const pkg = String(screeningPackageId || "").trim();
  if (pkg) {
    try {
      const { createBackgroundCheckInternal } = await import("../integrations/accusource/createBackgroundCheck");
      const { ensureAccusourceAdmin } = await import("../integrations/accusource/accusourceAdminGate");
      await ensureAccusourceAdmin(initiatedByUid, tenantId);

      const userSnap = await db.doc(`users/${trimmedUser}`).get();
      const u = userSnap.exists ? userSnap.data() || {} : {};
      const candidate = {
        firstName: String(u.firstName || ""),
        lastName: String(u.lastName || ""),
        email: String(u.email || ""),
        phone: String(u.phoneE164 || u.phone || ""),
        dateOfBirth: u.dateOfBirth ?? u.dob,
      };

      const accountId =
        String((entityDoc as { accusourceAccountId?: string }).accusourceAccountId || "").trim() ||
        String((entityDoc as { accountId?: string }).accountId || "").trim() ||
        undefined;

      const result = await createBackgroundCheckInternal(
        {
          tenantId,
          accountId,
          accountName: entityName,
          candidateId: trimmedUser,
          candidateName:
            [candidate.firstName, candidate.lastName].filter(Boolean).join(" ").trim() ||
            String(u.email || trimmedUser),
          requestedPackageId: pkg,
          requestedPackageName: screeningPackageName ? String(screeningPackageName).trim() : undefined,
          candidate,
        },
        initiatedByUid,
        { type: "callable", auth: authForAccusource || {} }
      );

      await db.collection("backgroundChecks").doc(result.backgroundCheckId).set(
        {
          automationSource: "on_call_employment",
          automationTenantId: tenantId,
          automationHiringEntityId: trimmedEntity,
          relationshipEntityKey: entityKey,
        },
        { merge: true }
      );

      await writeOnboardingAutomationDispatchLog({
        tenantId,
        eventType: "on_call_screening_ordered",
        correlationKey: `on_call_screening__${ON_CALL_AUDIT_V}__${tenantId}__${result.backgroundCheckId}`,
        assignmentId: "",
        userId: trimmedUser,
        outcome: "sent",
        hiringEntityId: trimmedEntity,
        details: { backgroundCheckId: result.backgroundCheckId, packageId: pkg },
      });
    } catch (e: unknown) {
      logger.warn("on-call screening order failed", {
        tenantId,
        pipelineId,
        error: e instanceof Error ? e.message : String(e),
      });
      await writeOnboardingAutomationDispatchLog({
        tenantId,
        eventType: "on_call_screening_ordered",
        correlationKey: `on_call_screening_failed__${ON_CALL_AUDIT_V}__${tenantId}__${pipelineId}__${Date.now()}`,
        assignmentId: "",
        userId: trimmedUser,
        outcome: "failed",
        hiringEntityId: trimmedEntity,
        skipReason: e instanceof Error ? e.message : String(e),
        details: { packageId: pkg },
      });
    }
  }

  return {
    pipelineId,
    created,
    entityKey,
    hiringEntityId: trimmedEntity,
    entityName,
  };
}

export const startOnCallEmployment = onCall(onCallWithTwilioSms, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = (request.data || {}) as StartOnCallEmploymentPayload;
  if (!data.tenantId || !data.userId || !data.entityId) {
    throw new HttpsError("invalid-argument", "tenantId, userId, and entityId are required");
  }
  if (!(await canManageOnboarding(request.auth, data.tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to start on-call employment");
  }

  try {
    return await runStartOnCallEmploymentFlow({
      ...data,
      initiatedByUid: request.auth.uid,
      authForAccusource: { token: request.auth.token as Record<string, unknown> | undefined },
    });
  } catch (e: unknown) {
    if (e instanceof HttpsError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("startOnCallEmployment failed", { message: msg, stack: e instanceof Error ? e.stack : undefined });
    throw new HttpsError(
      "failed-precondition",
      msg.length > 320 ? `${msg.slice(0, 320)}…` : msg || "Could not start on-call employment"
    );
  }
});

/**
 * Same payload and outcome as {@link startOnCallEmployment}, but enforces on-call-only policy:
 * hiring entity must allow on-call pool hires, and the target worker must be associated with the tenant.
 */
export const startOnCallOnboarding = onCall(onCallWithTwilioSms, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }

  const data = (request.data || {}) as StartOnCallEmploymentPayload;
  if (!data.tenantId || !data.userId || !data.entityId) {
    throw new HttpsError("invalid-argument", "tenantId, userId, and entityId are required");
  }
  if (!(await canManageOnboarding(request.auth, data.tenantId, request.auth.uid))) {
    throw new HttpsError("permission-denied", "Insufficient permissions to start on-call onboarding");
  }

  try {
    return await runStartOnCallEmploymentFlow({
      ...data,
      initiatedByUid: request.auth.uid,
      authForAccusource: { token: request.auth.token as Record<string, unknown> | undefined },
      enforceOnCallOnboardingPolicy: true,
    });
  } catch (e: unknown) {
    if (e instanceof HttpsError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("startOnCallOnboarding failed", { message: msg, stack: e instanceof Error ? e.stack : undefined });
    throw new HttpsError(
      "failed-precondition",
      msg.length > 320 ? `${msg.slice(0, 320)}…` : msg || "Could not start on-call employment"
    );
  }
});
