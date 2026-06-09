/**
 * Pre-assignment / labor-pool hire: opens entity employment + worker_onboarding without an assignment.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

import {
  canManageOnboarding,
  ensureWorkerOnboardingPipeline,
  type WorkerOnboardingPipelineTriggerSource,
} from "./workerOnboardingPipeline";
import { dispatchOnCallEmploymentStarted } from "../messaging/onCallEmploymentDispatch";
import {
  runEvereePayrollOnboardingInviteAfterOnCallProvision,
  runPayrollOnboardingInviteForOnCallEmployment,
} from "../messaging/payrollOnCallInvite";
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
import { sendGridFromEmail, sendGridFromName } from "../messaging/emailProviderFactory";
import { getEvereeConfigForEntity } from "../integrations/everee/evereeConfig";
import { createWorkerIfNeeded, normalizeDobToISO } from "../integrations/everee/evereeService";
import { extractEvereeHomeAddressFromUserDoc } from "../integrations/everee/evereeUserAddress";
import { resolveEvereeWorkerTypeForOnCall } from "../integrations/everee/evereeEntityWorkerType";
import { mirrorWorkEligibilityFromAuthoritativeSource } from "../utils/workEligibilityMirror";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const ON_CALL_AUDIT_V = "v1";

const onCallWithTwilioSms = {
  cors: true as const,
  /** Match `applicationSmsTriggers`: bind SendGrid From secrets only; API key uses env (`SENDGRID_API_KEY`). */
  secrets: [
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_PHONE_NUMBER,
    TWILIO_A2P_CAMPAIGN,
    sendGridFromEmail,
    sendGridFromName,
  ],
  /** Twilio + onboarding graph; 256 MiB OOM seen in prod. */
  memory: '512MiB' as const,
};

export interface StartOnCallEmploymentPayload {
  tenantId: string;
  userId: string;
  entityId: string;
  workerType?: "w2" | "1099" | "entity_default" | null;
  screeningPackageId?: string | null;
  screeningPackageName?: string | null;
  /**
   * À la carte SourceDirect service IDs (same catalog as Backgrounds → Order screening).
   * Sent on the same partial-profile request as `packageId` via `orders: [{ serviceId }]`.
   */
  screeningRequestedServiceIds?: string[] | null;
  note?: string | null;
  /**
   * Override for `worker_onboarding.triggeredBy.source`. Defaults to `"on_call"`
   * for the recruiter-initiated callable surfaces. Auto-onboarding triggers
   * (e.g. C1 Events public-apply auto-on-call) pass their own source value so
   * we can filter analytics on origin without rewriting the rest of the flow.
   */
  triggerSource?: WorkerOnboardingPipelineTriggerSource;
  /**
   * Source application id (`tenants/{tid}/applications/{id}`) when the on-call
   * employment was created by an application trigger. Stored on the audit
   * dispatch log + `entity_employments` row for traceability. Optional; only
   * set by `onApplicationCreatedPush`-style callers today.
   */
  applicationId?: string | null;
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
    /**
     * When true, skip all worker-facing notification dispatches (recruiter
     * audit "on-call employment started" email/SMS, pre-Everee payroll invite,
     * post-Everee payroll invite). Pipeline + entity_employment + Everee
     * provisioning still run; only the customer-facing messaging is held back.
     *
     * Use case: bulk migrations (Tempworks → HRX → Everee) where workers
     * receive a single curated migration message via a separate mass-send
     * tool, and the per-row default "complete your C1 onboarding" template
     * would arrive without context. Also avoids hitting Twilio's 1-msg/sec
     * sender-ID rate limit when fan-out is high (3,000 workers × 10 in-flight
     * concurrency = burst 10/sec without this flag).
     *
     * Audit trail: when suppressed, a single dispatch log row with
     * `outcome: "suppressed"` and `eventType: "on_call_notifications_suppressed"`
     * records the deliberate skip so the audit trail is honest about the
     * actor having opted out.
     */
    suppressNotifications?: boolean;
  }
): Promise<{
  pipelineId: string;
  created: boolean;
  entityKey: string;
  hiringEntityId: string;
  entityName: string;
  /**
   * Non-blocking hint when Everee auto-provision was skipped or failed.
   * On-call employment still succeeds; recruiter can sync from Employment later.
   */
  evereeProvisionWarning?: string | null;
}> {
  const {
    tenantId,
    userId,
    entityId,
    workerType: workerTypeRaw,
    screeningPackageId,
    screeningPackageName,
    screeningRequestedServiceIds,
    note,
    initiatedByUid,
    authForAccusource,
    enforceOnCallOnboardingPolicy,
    triggerSource: triggerSourceOverride,
    applicationId,
    suppressNotifications,
  } = args;
  const effectiveTriggerSource: WorkerOnboardingPipelineTriggerSource =
    triggerSourceOverride ?? "on_call";
  const trimmedApplicationId =
    typeof applicationId === "string" && applicationId.trim() ? applicationId.trim() : null;

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
    triggerSource: effectiveTriggerSource,
    employmentEntryMode: "on_call_pool",
    onCallNote: note ?? null,
    onCallScreeningPackageId: screeningPackageId ?? null,
    onCallScreeningPackageName: screeningPackageName ?? null,
    workerTypeOverride,
    suppressPipelineStartedAutomation: true,
    // Belt-and-suspenders for bulk-migration suppression: when the caller
    // opts out of customer-facing dispatches via `suppressNotifications`,
    // also stop the pipeline-internal `dispatchWorkerHired` (gated by
    // `suppressOutboundAutomation` at workerOnboardingPipeline.ts:562)
    // and `dispatchWorkerOnboardingPipelineStarted` (gated by both
    // `suppressPipelineStartedAutomation` and `suppressOutboundAutomation`
    // at workerOnboardingPipeline.ts:584). These two were the load-bearing
    // BI.0 leak surfaced during the c1_events_llc dry-run window — the
    // suppressNotifications block below covers `dispatchOnCallEmploymentStarted`
    // + the pre/post Everee invites but did NOT reach inside the pipeline.
    // The dispatchers ALSO carry their own doc-level migrationSource gate
    // (see `userIsInActiveMigration`) — that's the architectural defense
    // for any other caller of `ensureWorkerOnboardingPipeline` that
    // forgets these flags.
    suppressOutboundAutomation: !!suppressNotifications,
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
      // Source attribution. We don't overwrite if the row was created via a
      // different path earlier; the field doc carries the original source.
      ...(trimmedApplicationId
        ? { sourceApplicationId: trimmedApplicationId }
        : {}),
      ...(triggerSourceOverride
        ? { onboardingTriggerSource: triggerSourceOverride }
        : {}),
    },
    { merge: true }
  );

  // W.1 — work-eligibility mirror (1099 contractor / federal contractor rule).
  // Federal labor law: 1099 contractors do not require an I-9, so we can
  // assert work-authorization at on-call employment creation without any
  // worker-side attestation step. W-2 employees are mirrored later when
  // their Everee I-9 onboarding completes (see
  // `mirrorEvereeOnboardingCompleteToEmployments`).
  //
  // Runs regardless of `EVEREE_ENABLED`: the rule is about classification,
  // not about whether we've actually provisioned the worker in Everee yet.
  // `resolveEvereeWorkerTypeForOnCall` is a pure function on the entity doc.
  //
  // Non-blocking: helper logs internal failures and never throws.
  try {
    const eligibilityWorkerType = resolveEvereeWorkerTypeForOnCall(
      trimmedEntity,
      entityDoc as Record<string, unknown>,
    );
    if (eligibilityWorkerType === "contractor") {
      await mirrorWorkEligibilityFromAuthoritativeSource({
        userId: trimmedUser,
        source: "contractor_no_i9_required",
        callerContext: "runStartOnCallEmploymentFlow",
        tenantId,
        entityId: trimmedEntity,
      });
    }
  } catch (e: unknown) {
    logger.warn("[on_call] work_eligibility_mirror_failed", {
      tenantId,
      userId: trimmedUser,
      entityId: trimmedEntity,
      error: e instanceof Error ? e.message : String(e),
    });
  }

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
      triggerSource: effectiveTriggerSource,
      ...(trimmedApplicationId ? { applicationId: trimmedApplicationId } : {}),
    },
  });

  if (suppressNotifications) {
    // Honest audit trail: record that we deliberately skipped the customer-
    // facing dispatches. Single row covers both pre- and post-Everee invites
    // so the trail doesn't lie about which step "succeeded" silently.
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: "on_call_notifications_suppressed",
      correlationKey: `on_call_notifications_suppressed__${ON_CALL_AUDIT_V}__${tenantId}__${pipelineId}`,
      assignmentId: "",
      userId: trimmedUser,
      outcome: "skipped",
      skipReason: "suppressNotifications=true (caller opted out of customer-facing dispatches)",
      hiringEntityId: trimmedEntity,
      details: {
        pipelineId,
        entityKey,
        initiatedByUid,
        // Explicit list of dispatches that were skipped — useful when
        // grepping logs to confirm a specific run's behavior.
        suppressedDispatches: [
          "dispatchOnCallEmploymentStarted",
          "runPayrollOnboardingInviteForOnCallEmployment",
          "runEvereePayrollOnboardingInviteAfterOnCallProvision",
          // Pipeline-internal dispatchers — suppressed via
          // `suppressOutboundAutomation: true` on ensureWorkerOnboardingPipeline
          // above. Listed here so the audit row tells the full story.
          "dispatchWorkerHired",
          "dispatchWorkerOnboardingPipelineStarted",
        ],
      },
    });
  } else {
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
  }

  const pkg = String(screeningPackageId || "").trim();
  const screeningServiceIdsNormalized = Array.isArray(screeningRequestedServiceIds)
    ? screeningRequestedServiceIds.map((x) => String(x).trim()).filter(Boolean)
    : [];

  // System actors (e.g. `system:auto_user_group_member_added`) are internal
  // trigger flows, not human callers. `ensureAccusourceAdmin` is a *human*
  // caller guardrail — it `get`s the user doc and rejects when missing.
  // Synthetic system uids have no user doc, so they used to silently drop
  // bg-check orders (caught by the try/catch below) → "User profile not
  // found." in the dispatch log. We trust system actors by definition; the
  // wrapping flows already enforce their own authn / authz.
  const initiatedBySystemActor =
    typeof initiatedByUid === "string" && initiatedByUid.startsWith("system:");

  if (pkg || screeningServiceIdsNormalized.length > 0) {
    try {
      const { createBackgroundCheckInternal } = await import("../integrations/accusource/createBackgroundCheck");
      if (!initiatedBySystemActor) {
        const { ensureAccusourceAdmin } = await import("../integrations/accusource/accusourceAdminGate");
        await ensureAccusourceAdmin(initiatedByUid, tenantId);
      }

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
          requestedPackageId: pkg || undefined,
          requestedPackageName: screeningPackageName ? String(screeningPackageName).trim() : undefined,
          requestedServices: screeningServiceIdsNormalized.length > 0 ? screeningServiceIdsNormalized : undefined,
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
        details: {
          backgroundCheckId: result.backgroundCheckId,
          packageId: pkg || null,
          requestedServiceIds:
            screeningServiceIdsNormalized.length > 0 ? screeningServiceIdsNormalized : undefined,
        },
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
        details: {
          packageId: pkg || null,
          requestedServiceIds:
            screeningServiceIdsNormalized.length > 0 ? screeningServiceIdsNormalized : undefined,
        },
      });
    }
  } else {
    // Audit explicitly that we intentionally did NOT order a bg check. Before
    // this row existed the no-package branch was completely silent — a hire
    // into a group with no `accusourcePackageId` looked identical in the
    // dispatch log to a hire into a group that should have ordered. That made
    // the 553-hires-no-orders C1 Events pattern invisible until it was
    // diagnosed by cross-referencing `backgroundChecks` to dispatch logs.
    // Recording the skip here makes the intent observable in the audit
    // dashboard with a stable `skipReason` for filtering.
    await writeOnboardingAutomationDispatchLog({
      tenantId,
      eventType: "on_call_screening_skipped",
      correlationKey: `on_call_screening_skipped__${ON_CALL_AUDIT_V}__${tenantId}__${pipelineId}`,
      assignmentId: "",
      userId: trimmedUser,
      outcome: "skipped",
      hiringEntityId: trimmedEntity,
      skipReason: "no_package_configured",
      details: {
        packageId: null,
        requestedServiceIds: null,
        initiatedBySystemActor,
      },
    });
  }

  let evereeProvisionWarning: string | null = null;
  let evereePostProvisionInvite: {
    evereeTenantId: string;
    firstName: string;
    workerPayrollType: "w2" | "1099";
  } | null = null;

  try {
    const evereeCfg = await getEvereeConfigForEntity(tenantId, trimmedEntity);
    if (evereeCfg && process.env.EVEREE_ENABLED === "true") {
      const userSnap = await db.doc(`users/${trimmedUser}`).get();
      const u = (userSnap.exists ? userSnap.data() : {}) as Record<string, unknown>;
      const workerEvereeType = resolveEvereeWorkerTypeForOnCall(trimmedEntity, entityDoc as Record<string, unknown>);
      const home = extractEvereeHomeAddressFromUserDoc(u);
      // 2026-05-26 — the original comment here claimed "no address gate"
      // because W-2 used a server stub and contractors didn't need it.
      // Both halves of that turned out to trip Everee's anti-fraud
      // lockout in production (see `evereeService.createWorkerIfNeeded`
      // anti-fraud guards). The downstream throw is correct; we just
      // want to fail with a CLEAR error before reaching it so the
      // try/catch around this block surfaces the right warning instead
      // of a vague Everee-side error.
      if (!home) {
        throw new Error(
          `[on_call] Cannot provision Everee worker without a complete home address ` +
            `on users/${trimmedUser}.addressInfo (street, city, state, 5-digit ZIP). ` +
            `Both W-2 and 1099 paths require it — Everee locks accounts created with ` +
            `an empty or placeholder homeAddress.`,
        );
      }
      const phone =
        String(u.phoneE164 ?? "").trim() ||
        String(u.phone ?? "").trim() ||
        String(u.phoneNumber ?? "").trim();
      // 2026-05-27 — pass DOB at provision time. Pre-fix, Everee's
      // anti-fraud engine flipped accountAccessPermitted: false on
      // new workers because they had no identity-verification signal
      // (no DOB, no SSN). Validating "YYYY-MM-DD" here so a malformed
      // value can't 422 the create.
      // Robustly normalize whatever shape DOB is stored in (Timestamp,
      // ISO, US M/D/YYYY, "Jun 4, 1990") to Everee's YYYY-MM-DD. Pre-fix this
      // only accepted an exact YYYY-MM-DD and dropped everything else, which
      // left Everee with no DOB → anti-fraud lockout.
      const dateOfBirth = normalizeDobToISO(u.dateOfBirth ?? u.dob) ?? undefined;
      await createWorkerIfNeeded({
        tenantId,
        entityId: trimmedEntity,
        userId: trimmedUser,
        firebaseUid: trimmedUser,
        workerType: workerEvereeType,
        email: String(u.email ?? ""),
        firstName: String(u.firstName ?? ""),
        lastName: String(u.lastName ?? ""),
        phone,
        dateOfBirth,
        homeAddress: home,
        hireDate: new Date().toISOString().slice(0, 10),
      });
      evereePostProvisionInvite = {
        evereeTenantId: evereeCfg.evereeTenantId,
        firstName: String(u.firstName ?? ""),
        workerPayrollType: workerEvereeType === "contractor" ? "1099" : "w2",
      };
    }
  } catch (e: unknown) {
    logger.warn("[on_call] Everee provision failed (non-blocking)", {
      tenantId,
      hiringEntityId: trimmedEntity,
      userId: trimmedUser,
      error: e instanceof Error ? e.message : String(e),
    });
    evereeProvisionWarning =
      "Everee payroll setup did not complete automatically. Use Employment → payroll sync when the worker profile is ready.";
  }

  if (!evereeProvisionWarning && evereePostProvisionInvite && !suppressNotifications) {
    try {
      await runEvereePayrollOnboardingInviteAfterOnCallProvision({
        tenantId,
        userId: trimmedUser,
        hiringEntityId: trimmedEntity,
        entityName,
        entityKey,
        pipelineId,
        evereeTenantId: evereePostProvisionInvite.evereeTenantId,
        firstName: evereePostProvisionInvite.firstName,
        workerType: evereePostProvisionInvite.workerPayrollType,
      });
    } catch (e: unknown) {
      logger.warn("runEvereePayrollOnboardingInviteAfterOnCallProvision failed", {
        tenantId,
        pipelineId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    pipelineId,
    created,
    entityKey,
    hiringEntityId: trimmedEntity,
    entityName,
    evereeProvisionWarning,
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
