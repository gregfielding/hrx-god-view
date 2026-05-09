/**
 * Recruiter-triggered "Restart Everee Onboarding" callable.
 *
 * Built for the legacy-payroll → Everee migration scenario, where a worker:
 *   - has an `entity_employments` row on an Everee-enabled entity,
 *   - has been provisioned in Everee already
 *     (`users/{uid}.evereeWorkerIds[evereeTenantId]` populated — see
 *     `evereeEnsureWorker` / the "Sync to Everee" button), and
 *   - was *previously* marked as payroll-complete by some prior system
 *     (TempWorks today; could be any pre-Everee flow tomorrow), so the
 *     My Employment hub silences the payroll step and the scheduler at
 *     `processWorkerOnboardingReminders` skips them
 *     (`hasIncompleteOnboarding` short-circuits when
 *     `isPayrollComplete(emp.payrollStatus)` is true).
 *
 * Mirrors the `.scratch/restartEvereeOnboardingForOneWorker.js` script —
 * keep the field-write set in lockstep. The script is the "fix one worker
 * right now" tool; this callable is the production-grade version with auth
 * checks, audit logging, and an inline R1 send so the recruiter sees an
 * SMS go out before the next 60-min scheduler tick.
 *
 * What it does (idempotent — safe to re-run):
 *   1. Resolves the entity + verifies Everee shell is live.
 *   2. Resets `payrollStatus` (delete) + `onboardingComplete: false`.
 *   3. Anchors the cadence at "now": `onCallStartedAt = now`.
 *   4. Writes `onboardingReminder{1..N}DueAt`:
 *        - events entity → R1–R5 (2h / 24h / 48h / 96h / 168h)
 *        - non-events     → R1–R3 (2h / 24h / 48h)
 *      Cadence offsets are intentionally identical to the scheduler's so
 *      a "restart" produces the same downstream timeline as a fresh hire.
 *   5. Clears `onboardingReminder{1..5}SentAt`.
 *   6. Sends R1 *inline* now (uses the same body + link picker the scheduler
 *      uses; events → direct Everee URL, non-events → My Employment hub).
 *   7. Writes audit rows: one for the manual restart action
 *      (`reminderNumber: 0, source: 'manual_restart'`) plus the standard
 *      R1 send audit so the cadence shows the immediate fire.
 *
 * Permission gate: same as `resendOnboardingPayrollLink` —
 * `canManageOnboarding` (HRX or Admin/Recruiter/Manager on this tenant).
 *
 * Out of scope:
 *   - Creating the Everee shell (caller must click "Sync to Everee" first;
 *     we return `needs_sync` if `evereeWorkerIds[evereeTenantId]` is missing).
 *   - Resetting `worker_onboarding/{userId}__{entityKey}` step state — that
 *     doc is rebuilt lazily by the worker hub UI on next visit.
 *   - Touching I-9 / E-Verify state — separate flow.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from './workerOnboardingPipeline';
import { sendWorkerMessageInternal } from '../twilio';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';
import {
  buildWorkerEntityEmploymentUrl,
  buildWorkerPayrollEvereeTenantUrl,
} from '../utils/workerUrls';
import { userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { getEvereeConfigForEntity } from '../integrations/everee/evereeConfig';
import { buildOnboardingReminderSmsBody } from './processWorkerOnboardingReminders';
import { deriveEntityKeyFromName } from './workerOnboardingPipeline';
import { createWorkerIfNeeded } from '../integrations/everee/evereeService';
import { resolveEvereeWorkerTypeForOnCall } from '../integrations/everee/evereeEntityWorkerType';
import { extractEvereeHomeAddressFromUserDoc } from '../integrations/everee/evereeUserAddress';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/** Cadence offsets — must match `processWorkerOnboardingReminders.ts`. */
const REMINDER_1_MS = 2 * 60 * 60 * 1000;
const REMINDER_2_MS = 24 * 60 * 60 * 1000;
const REMINDER_3_MS = 48 * 60 * 60 * 1000;
const REMINDER_4_MS = 96 * 60 * 60 * 1000;
const REMINDER_5_MS = 168 * 60 * 60 * 1000;

function isEventsEntityKey(entityKey: unknown): boolean {
  return String(entityKey || '').trim().toLowerCase() === 'events';
}

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = String(data.phoneE164 || '').trim();
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = String(data.phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function firstNameFromUser(ud: Record<string, unknown>): string {
  return (
    String(ud.firstName || (String(ud.displayName || '').trim().split(/\s+/)[0] || '') || 'there').trim() || 'there'
  );
}

function workerLang(ud: Record<string, unknown>): 'en' | 'es' {
  return String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
}

export type RestartEvereeOnboardingResult = {
  ok: boolean;
  pipelineId: string;
  variant: 'standard' | 'events';
  /** Final R1 URL — useful for the success toast. */
  link: string;
  /** ISO timestamps so the client can render the new cadence preview. */
  scheduledReminders: {
    r1: string;
    r2: string;
    r3: string;
    r4?: string;
    r5?: string;
  };
  /**
   * True when this restart had to provision the Everee shell inline (the
   * legacy-pre-Everee migration scenario). The client uses this to show a
   * richer success message — "Provisioned Everee + restarted onboarding"
   * vs. the standard "restarted onboarding". When false, the shell already
   * existed before the call.
   */
  evereeShellProvisioned?: boolean;
  /** Set when ok=false: entity_not_everee, employment_not_found,
   *  user_not_found, missing_phone, invalid_e164, missing_link, sms_failed,
   *  everee_provision_failed. (`needs_sync` is no longer returned — the
   *  callable now provisions inline, see `evereeShellProvisioned`.) */
  reason?: string;
  twilioError?: string;
};

interface RestartEvereeOnboardingInput {
  tenantId: string;
  userId: string;
  entityId: string;
}

function parseInput(raw: unknown): RestartEvereeOnboardingInput {
  const obj = (raw || {}) as Record<string, unknown>;
  const tenantId = typeof obj.tenantId === 'string' ? obj.tenantId.trim() : '';
  const userId = typeof obj.userId === 'string' ? obj.userId.trim() : '';
  const entityId = typeof obj.entityId === 'string' ? obj.entityId.trim() : '';
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId is required');
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required');
  if (!entityId) throw new HttpsError('invalid-argument', 'entityId is required');
  return { tenantId, userId, entityId };
}

export const restartEvereeOnboarding = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<RestartEvereeOnboardingResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const { tenantId, userId, entityId } = parseInput(request.data);

    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    // 1. Resolve entity + Everee config. We need both `entityKey` (to
    //    reconstruct pipelineId + pick variant) and `evereeTenantId` (for
    //    the direct payroll URL on events workers + the shell-existence
    //    check below).
    const entitySnap = await db.doc(`tenants/${tenantId}/entities/${entityId}`).get();
    if (!entitySnap.exists) {
      throw new HttpsError('not-found', `Entity ${entityId} not found on tenant ${tenantId}`);
    }
    const entityData = (entitySnap.data() || {}) as Record<string, unknown>;
    // May 2026 — entity docs created before the `entityKey` migration may be
    // missing this field (we saw it on `c1_events_llc` in production). Rather
    // than refusing the restart, derive the key from the entity name (same
    // helper `resolveEntityContext` uses for fresh on-call hires), backfill
    // the field on the entity doc so future reads have it, and continue. The
    // ONLY case where we still hard-fail is when the name itself is empty —
    // which would mean the entity record is malformed beyond what this
    // recruiter-facing tool should try to repair.
    let entityKey = String(entityData.entityKey || '').trim();
    if (!entityKey) {
      const entityName = String(
        entityData.name || entityData.legalName || entityData.title || '',
      );
      if (!entityName.trim()) {
        throw new HttpsError(
          'failed-precondition',
          `Entity ${entityId} has no entityKey and no name — cannot reconstruct pipelineId`,
        );
      }
      entityKey = deriveEntityKeyFromName(entityName);
      // Best-effort backfill so the next restart / resend / Everee-related
      // callable hits the canonical field directly. Non-blocking — a write
      // failure here is logged but shouldn't abort the restart the recruiter
      // is actively waiting on.
      try {
        await entitySnap.ref.update({
          entityKey,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        logger.info('restartEvereeOnboarding: backfilled missing entityKey', {
          tenantId,
          entityId,
          entityKey,
          derivedFromName: entityName,
        });
      } catch (e: unknown) {
        logger.warn('restartEvereeOnboarding: entityKey backfill failed', {
          tenantId,
          entityId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (entityData.evereeEnabled !== true) {
      return {
        ok: false,
        pipelineId: `${userId}__${entityKey}`,
        variant: 'standard',
        link: '',
        scheduledReminders: { r1: '', r2: '', r3: '' },
        reason: 'entity_not_everee',
      };
    }
    const evereeTenantId = String(entityData.evereeTenantId || '').trim();
    if (!evereeTenantId) {
      return {
        ok: false,
        pipelineId: `${userId}__${entityKey}`,
        variant: 'standard',
        link: '',
        scheduledReminders: { r1: '', r2: '', r3: '' },
        reason: 'entity_not_everee',
      };
    }

    const pipelineId = `${userId}__${entityKey}`;

    // 2. Verify the entity_employments doc exists. Caller's expectation:
    //    they're looking at this card because the worker IS hired on this
    //    entity. If the row's gone, something else is wrong upstream.
    const empPath = `tenants/${tenantId}/entity_employments/${pipelineId}`;
    const empSnap = await db.doc(empPath).get();
    if (!empSnap.exists) {
      return {
        ok: false,
        pipelineId,
        variant: 'standard',
        link: '',
        scheduledReminders: { r1: '', r2: '', r3: '' },
        reason: 'employment_not_found',
      };
    }
    const emp = (empSnap.data() || {}) as Record<string, unknown>;

    // 3. User doc — phone (for SMS) + name (for body) + Everee shell check.
    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      return {
        ok: false,
        pipelineId,
        variant: 'standard',
        link: '',
        scheduledReminders: { r1: '', r2: '', r3: '' },
        reason: 'user_not_found',
      };
    }
    const userData = (userSnap.data() || {}) as Record<string, unknown>;
    const evereeWorkerIdsMap = (userData.evereeWorkerIds || {}) as Record<string, unknown>;
    let evereeWorkerId =
      typeof evereeWorkerIdsMap[evereeTenantId] === 'string'
        ? String(evereeWorkerIdsMap[evereeTenantId]).trim()
        : '';

    // May 2026 — pre-Everee migration support. Workers who started
    // onboarding on a C1 entity *before* that entity was wired to Everee
    // (today: c1_events_llc workers carried over from TempWorks) won't
    // have a shell on the Everee side yet. Previously this callable
    // returned `needs_sync` and made the recruiter click "Sync to Everee"
    // first, then "Restart onboarding" — two clicks for what's morally a
    // single "start over for this user/entity" action.
    //
    // We now provision the shell inline using the same idempotent helper
    // (`createWorkerIfNeeded`) the Sync button calls, then continue with
    // the cadence reset + R1 send below. Net effect: clicking "Restart
    // onboarding" on a worker with no shell behaves like a fresh on-call
    // hire (provision Everee → set up cadence → SMS R1 now), which is
    // exactly what the recruiter expects when starting an onboarding over.
    let evereeShellProvisioned = false;
    if (!evereeWorkerId) {
      try {
        const workerEvereeType = resolveEvereeWorkerTypeForOnCall(
          entityId,
          entityData,
        );
        const phone =
          String(userData.phoneE164 ?? '').trim() ||
          String(userData.phone ?? '').trim() ||
          String((userData as { phoneNumber?: unknown }).phoneNumber ?? '').trim();
        const home = extractEvereeHomeAddressFromUserDoc(userData);
        const created = await createWorkerIfNeeded({
          tenantId,
          entityId,
          userId,
          firebaseUid: userId,
          workerType: workerEvereeType,
          email: typeof userData.email === 'string' ? userData.email : undefined,
          firstName: typeof userData.firstName === 'string' ? userData.firstName : undefined,
          lastName: typeof userData.lastName === 'string' ? userData.lastName : undefined,
          phone: phone || undefined,
          ...(home ? { homeAddress: home } : {}),
          hireDate: new Date().toISOString().slice(0, 10),
        });
        evereeWorkerId = created.evereeWorkerId.trim();
        evereeShellProvisioned = created.created;
        logger.info('restartEvereeOnboarding: provisioned Everee shell inline', {
          tenantId,
          userId,
          entityId,
          evereeTenantId,
          evereeWorkerId,
          newlyCreated: created.created,
        });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error('restartEvereeOnboarding: inline Everee provision failed', {
          tenantId,
          userId,
          entityId,
          evereeTenantId,
          error: errMsg,
        });
        return {
          ok: false,
          pipelineId,
          variant: 'standard',
          link: '',
          scheduledReminders: { r1: '', r2: '', r3: '' },
          reason: 'everee_provision_failed',
          twilioError: errMsg.slice(0, 320),
        };
      }
      if (!evereeWorkerId) {
        return {
          ok: false,
          pipelineId,
          variant: 'standard',
          link: '',
          scheduledReminders: { r1: '', r2: '', r3: '' },
          reason: 'everee_provision_failed',
        };
      }
    }

    // 4. Pick variant + R1 link. Same logic as
    //    `processWorkerOnboardingReminders.sendOnboardingReminderSms`.
    const eventsEntity = isEventsEntityKey(entityKey);
    let link = '';
    let variant: 'standard' | 'events' = 'standard';
    if (eventsEntity) {
      const directUrl = buildWorkerPayrollEvereeTenantUrl(evereeTenantId);
      if (directUrl) {
        link = directUrl;
        variant = 'events';
      } else {
        link = buildWorkerEntityEmploymentUrl(pipelineId);
      }
    } else {
      link = buildWorkerEntityEmploymentUrl(pipelineId);
    }
    if (!link) {
      return {
        ok: false,
        pipelineId,
        variant,
        link: '',
        scheduledReminders: { r1: '', r2: '', r3: '' },
        reason: 'missing_link',
        evereeShellProvisioned,
      };
    }

    // 5. Compute new cadence + write all field updates atomically.
    const now = admin.firestore.Timestamp.now();
    const baseMs = now.toMillis();
    const r1 = admin.firestore.Timestamp.fromMillis(baseMs + REMINDER_1_MS);
    const r2 = admin.firestore.Timestamp.fromMillis(baseMs + REMINDER_2_MS);
    const r3 = admin.firestore.Timestamp.fromMillis(baseMs + REMINDER_3_MS);
    const r4 = admin.firestore.Timestamp.fromMillis(baseMs + REMINDER_4_MS);
    const r5 = admin.firestore.Timestamp.fromMillis(baseMs + REMINDER_5_MS);

    const updates: Record<string, unknown> = {
      onCallStartedAt: now,
      onboardingComplete: false,
      payrollStatus: admin.firestore.FieldValue.delete(),
      onboardingReminder1DueAt: r1,
      onboardingReminder2DueAt: r2,
      onboardingReminder3DueAt: r3,
      // Clear any stale send timestamps so the cadence re-fires from scratch.
      onboardingReminder1SentAt: admin.firestore.FieldValue.delete(),
      onboardingReminder2SentAt: admin.firestore.FieldValue.delete(),
      onboardingReminder3SentAt: admin.firestore.FieldValue.delete(),
      onboardingReminder4SentAt: admin.firestore.FieldValue.delete(),
      onboardingReminder5SentAt: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    };
    if (eventsEntity) {
      updates.onboardingReminder4DueAt = r4;
      updates.onboardingReminder5DueAt = r5;
    } else {
      updates.onboardingReminder4DueAt = admin.firestore.FieldValue.delete();
      updates.onboardingReminder5DueAt = admin.firestore.FieldValue.delete();
    }

    await db.doc(empPath).update(updates);

    // 6. Audit — manual restart sentinel. Mirrors the scheduler's audit
    //    schema so a single query against `onboarding_reminder_audit`
    //    shows the whole conversation history per worker.
    try {
      await db.collection(`tenants/${tenantId}/onboarding_reminder_audit`).add({
        userId,
        entityEmploymentId: pipelineId,
        entityId,
        entityKey,
        reminderNumber: 0,
        messageType: 'onboarding_reminder',
        source: 'manual_restart',
        initiatedByUid: request.auth.uid,
        variant,
        success: true,
        error: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: unknown) {
      logger.warn('restartEvereeOnboarding: restart audit write failed', {
        tenantId,
        userId,
        pipelineId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // 7. Inline R1 send. We deliberately fire R1 NOW rather than waiting
    //    for the next scheduler tick (up to 60 min) because a recruiter
    //    just clicked the button — they expect immediate movement and the
    //    worker is presumably on the phone with them.
    if (!userDocHasUsablePhone(userData)) {
      return {
        ok: false,
        pipelineId,
        variant,
        link,
        scheduledReminders: {
          r1: r1.toDate().toISOString(),
          r2: r2.toDate().toISOString(),
          r3: r3.toDate().toISOString(),
          ...(eventsEntity
            ? { r4: r4.toDate().toISOString(), r5: r5.toDate().toISOString() }
            : {}),
        },
        reason: 'missing_phone',
        evereeShellProvisioned,
      };
    }
    const phone = phoneE164FromUser(userData);
    if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return {
        ok: false,
        pipelineId,
        variant,
        link,
        scheduledReminders: {
          r1: r1.toDate().toISOString(),
          r2: r2.toDate().toISOString(),
          r3: r3.toDate().toISOString(),
          ...(eventsEntity
            ? { r4: r4.toDate().toISOString(), r5: r5.toDate().toISOString() }
            : {}),
        },
        reason: 'invalid_e164',
        evereeShellProvisioned,
      };
    }
    const lang = workerLang(userData);
    const fn = firstNameFromUser(userData);
    const body = buildOnboardingReminderSmsBody(fn, link, lang, variant);
    const result = await sendWorkerMessageInternal(phone, body, {
      systemContext: true,
      tenantId,
      userId,
      messageTypeId: 'onboarding_reminder',
      source: 'onboarding_reminder_manual_restart',
      sourceId: `${pipelineId}__r1__restart__${request.auth.uid}`,
    });

    // Mark R1 sent atomically with success so the scheduler skips it on the
    // next tick. If the SMS failed, we leave R1Sent unset — scheduler will
    // retry it on its own cadence (within 60 min, the next tick).
    if (result.success) {
      try {
        await db.doc(empPath).update({
          onboardingReminder1SentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e: unknown) {
        logger.warn('restartEvereeOnboarding: R1Sent write failed', {
          tenantId,
          userId,
          pipelineId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // R1 audit row — mirrors the scheduler's writeAudit shape.
    try {
      await db.collection(`tenants/${tenantId}/onboarding_reminder_audit`).add({
        userId,
        entityEmploymentId: pipelineId,
        entityId,
        entityKey,
        reminderNumber: 1,
        messageType: 'onboarding_reminder',
        source: 'manual_restart_r1',
        initiatedByUid: request.auth.uid,
        variant,
        success: result.success,
        error: result.success ? null : result.error || result.status || 'unknown',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e: unknown) {
      logger.warn('restartEvereeOnboarding: R1 audit write failed', {
        tenantId,
        userId,
        pipelineId,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    const scheduledReminders: RestartEvereeOnboardingResult['scheduledReminders'] = {
      r1: r1.toDate().toISOString(),
      r2: r2.toDate().toISOString(),
      r3: r3.toDate().toISOString(),
      ...(eventsEntity
        ? { r4: r4.toDate().toISOString(), r5: r5.toDate().toISOString() }
        : {}),
    };

    if (!result.success) {
      return {
        ok: false,
        pipelineId,
        variant,
        link,
        scheduledReminders,
        reason: 'sms_failed',
        twilioError: result.error || result.status || 'unknown',
        evereeShellProvisioned,
      };
    }

    // Used `unused` ref to silence linter — emp data was loaded for future
    // expansion (e.g. honoring an existing `lifecycleStage` override) but
    // isn't read on the happy path today.
    void emp;

    return {
      ok: true,
      pipelineId,
      variant,
      link,
      scheduledReminders,
      evereeShellProvisioned,
    };
  },
);
