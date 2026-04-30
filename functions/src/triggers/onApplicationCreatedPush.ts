/**
 * Application onCreate trigger: thank-you push + (now) C1 Events auto-on-call.
 *
 * The original FCM "thank-you" responsibility moved to the messaging
 * orchestrator (`sendLegacyApplicationStatusMessage` → `sendMessage`) so this
 * trigger no longer dispatches push directly — it would double-deliver
 * inbox / FCM rows.
 *
 * What it does today:
 *   - Status guard: only proceeds for `submitted` applications. Drafts
 *     (`in_progress`) are intentionally ignored.
 *   - C1 Events branch: when `hiringEntityId === 'c1_events_llc'`,
 *     auto-creates an on-call employment row (idempotent against
 *     `entity_employments`). The downstream
 *     `runStartOnCallEmploymentFlow` already handles Everee provisioning
 *     for tenant 3138 and the on-call cadence dispatch — we deliberately
 *     do not re-implement that work here. Address preflight bails before
 *     creating an employment row when the user doc has no usable home
 *     address (the wizard now enforces this client-side, but the trigger
 *     keeps a defensive backstop).
 *
 * Behavior contract for non-C1-Events applications: completely
 * unchanged — the trigger logs and returns.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

import { runStartOnCallEmploymentFlow } from '../onboarding/startOnCallEmployment';

if (!admin.apps.length) {
  admin.initializeApp();
}

const C1_EVENTS_ENTITY_ID = 'c1_events_llc';

/**
 * "System actor" uid stamped onto `worker_onboarding.triggeredBy.uid` when an
 * automated trigger (not a real user) runs the on-call flow. Mirrors the
 * `SYSTEM_ASSIGNMENT_CONFIRMED_ACTOR` pattern in `workerOnboardingPipeline`.
 */
const SYSTEM_AUTO_APPLICATION_ACTOR = 'system:auto_application_c1_events';

interface AutoOnCallContext {
  tenantId: string;
  applicationId: string;
  userId: string;
  hiringEntityId: string;
}

/**
 * Resolve `hiringEntityId` for the application. Pre-existing wizard submits
 * don't denormalize the field on the application doc, so we walk the
 * `jobOrder` link first and fall back to the `posting` doc. Returns `null`
 * when nothing is resolvable.
 */
async function resolveApplicationHiringEntityId(
  tenantId: string,
  applicationData: Record<string, unknown>,
): Promise<string | null> {
  const directRaw = applicationData?.hiringEntityId;
  if (typeof directRaw === 'string' && directRaw.trim()) return directRaw.trim();

  const db = admin.firestore();
  const jobOrderId = (() => {
    const v = applicationData?.jobOrderId;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  })();

  if (jobOrderId) {
    try {
      const jo = await db.doc(`tenants/${tenantId}/job_orders/${jobOrderId}`).get();
      if (jo.exists) {
        const heid = jo.data()?.hiringEntityId;
        if (typeof heid === 'string' && heid.trim()) return heid.trim();
      }
    } catch (e: unknown) {
      logger.warn('[application_created] resolve_hiring_entity_failed_jo', {
        tenantId,
        jobOrderId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return null;
}

/**
 * Idempotency check: any existing `entity_employments` row keyed
 * `${userId}__${entityKey}` for the C1 Events entity counts. Pipeline ids
 * carry the entity slug after `__`, so we look up the canonical id directly
 * before falling back to a query.
 */
async function alreadyHasC1EventsEmployment(
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const db = admin.firestore();
  // Primary lookup: pipeline ids are `${userId}__events` for C1 Events. The
  // entityKey ('events' / 'select' / 'workforce') matches `resolveEntityContext`
  // in `workerOnboardingPipeline` — no ambient state needed.
  const directIds = [`${userId}__events`];
  for (const id of directIds) {
    try {
      const snap = await db.doc(`tenants/${tenantId}/entity_employments/${id}`).get();
      if (snap.exists) return true;
    } catch {
      /* fall through to query */
    }
  }
  // Defensive secondary scan: query by `(userId, entityId)` in case the
  // pipeline-id convention drifts. Capped at 1 doc.
  try {
    const q = await db
      .collection(`tenants/${tenantId}/entity_employments`)
      .where('userId', '==', userId)
      .where('entityId', '==', C1_EVENTS_ENTITY_ID)
      .limit(1)
      .get();
    return !q.empty;
  } catch (e: unknown) {
    logger.warn('[application_created] employment_idempotency_query_failed', {
      tenantId,
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    // Fail-open on the idempotency check is unsafe — better to skip the
    // auto-on-call than risk a duplicate provisioning. Caller treats `true`
    // as "skip".
    return true;
  }
}

/**
 * Defensive address preflight. The apply wizard now blocks submit until a
 * Google Place is selected, but quick-apply / legacy paths could still call
 * `submitQuickApplication` against a profile with a partial address. We bail
 * before creating an employment row rather than letting the downstream Everee
 * provisioner stamp `evereeProvisionWarning` on a worker shell that won't
 * resolve without manual recruiter touch.
 */
async function hasUsableHomeAddress(userId: string): Promise<boolean> {
  const db = admin.firestore();
  let snap;
  try {
    snap = await db.doc(`users/${userId}`).get();
  } catch (e: unknown) {
    logger.warn('[application_created] address_preflight_user_read_failed', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
    return false;
  }
  if (!snap.exists) return false;
  const u = snap.data() ?? {};

  // Canonical shape (new): `homeAddress.{ formattedAddress, coordinates: { lat, lng } }`
  const home = (u as Record<string, unknown>).homeAddress as
    | { formattedAddress?: unknown; coordinates?: { lat?: unknown; lng?: unknown } }
    | undefined;
  if (home && typeof home === 'object') {
    const fa = typeof home.formattedAddress === 'string' ? home.formattedAddress.trim() : '';
    const lat = home.coordinates?.lat;
    const lng = home.coordinates?.lng;
    if (fa && typeof lat === 'number' && typeof lng === 'number') return true;
  }

  // Fallback to the legacy `addressInfo.{streetAddress, city, state, zip, homeLat, homeLng}`
  // shape that pre-wizard worker docs still use.
  const addr = (u as Record<string, unknown>).addressInfo as Record<string, unknown> | undefined;
  if (addr && typeof addr === 'object') {
    const street = String(addr.streetAddress ?? '').trim();
    const city = String(addr.city ?? '').trim();
    const state = String(addr.state ?? '').trim();
    const lat = addr.homeLat;
    const lng = addr.homeLng;
    if (street && city && state && typeof lat === 'number' && typeof lng === 'number') {
      return true;
    }
  }
  return false;
}

async function maybeAutoCreateC1EventsOnCall(ctx: AutoOnCallContext): Promise<void> {
  const { tenantId, applicationId, userId, hiringEntityId } = ctx;

  // Idempotency: don't re-create if employment already exists.
  const exists = await alreadyHasC1EventsEmployment(tenantId, userId);
  if (exists) {
    logger.info('[application_created] auto_oncall_skipped_already_employed', {
      tenantId,
      applicationId,
      userId,
      hiringEntityId,
    });
    return;
  }

  // Address preflight. Wizard enforces, but other apply surfaces may not.
  const addressOk = await hasUsableHomeAddress(userId);
  if (!addressOk) {
    logger.warn('everee.applicant.address_missing', {
      tenantId,
      applicationId,
      userId,
      hiringEntityId,
    });
    return;
  }

  try {
    const result = await runStartOnCallEmploymentFlow({
      tenantId,
      userId,
      entityId: hiringEntityId,
      // Mark the actor as the system trigger; recruiter dashboards keying on
      // `triggeredBy.uid` will see this distinct from manual hire actions.
      initiatedByUid: SYSTEM_AUTO_APPLICATION_ACTOR,
      triggerSource: 'auto_application_c1_events',
      applicationId,
      // C1 Events runs as 1099 contractors — keep the existing fallback path
      // (`resolveEvereeWorkerTypeForOnCall` reads the entity doc) instead of
      // hardcoding here, but pass `entity_default` to keep behavior identical
      // to the manual on-call hire button.
      workerType: 'entity_default',
      note: `Auto-onboarded from application ${applicationId}`,
    });

    logger.info('everee.applicant.auto_oncall_created', {
      tenantId,
      applicationId,
      userId,
      hiringEntityId,
      pipelineId: result.pipelineId,
      employmentId: result.pipelineId,
      created: result.created,
      evereeProvisionWarning: result.evereeProvisionWarning ?? null,
    });
  } catch (e: unknown) {
    // Soft-fail: an auto-on-call failure must not block downstream messaging
    // pipelines (`onApplicationStatusChanged` etc). The recruiter can still
    // hire manually from the User Profile.
    logger.error('everee.applicant.auto_oncall_failed', {
      tenantId,
      applicationId,
      userId,
      hiringEntityId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    });
  }
}

export const onApplicationCreatedPush = onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const { tenantId, applicationId } = event.params;
    const snap = event.data;
    if (!snap?.exists) return;

    const applicationData = snap.data() as Record<string, any>;
    const st = String(applicationData?.status || '').trim().toLowerCase();

    if (st !== 'submitted') {
      logger.info('[PUSH][application_created] skipped (delegated): status not submitted', {
        applicationId,
        tenantId,
        status: applicationData?.status,
      });
      return;
    }

    // C1 Events auto-on-call branch. Resolve `hiringEntityId` first so we can
    // skip non-C1-Events applications without a redundant Firestore read.
    try {
      const userId =
        typeof applicationData?.userId === 'string' && applicationData.userId.trim()
          ? applicationData.userId.trim()
          : null;
      if (userId) {
        const hiringEntityId = await resolveApplicationHiringEntityId(tenantId, applicationData);
        if (hiringEntityId === C1_EVENTS_ENTITY_ID) {
          await maybeAutoCreateC1EventsOnCall({
            tenantId,
            applicationId,
            userId,
            hiringEntityId,
          });
        }
      }
    } catch (e: unknown) {
      // Outer guard so any unexpected error never breaks the messaging
      // orchestrator's downstream listeners on this same application doc.
      logger.error('[application_created] auto_oncall_branch_unexpected_failure', {
        tenantId,
        applicationId,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }

    logger.info(
      '[PUSH][application_created] skipped (delegated to messaging orchestrator for application_received)',
      { applicationId, tenantId }
    );
  }
);
