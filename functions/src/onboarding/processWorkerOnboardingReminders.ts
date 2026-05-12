/**
 * Scheduled: automated SMS reminders for on-call workers with incomplete onboarding (I-9 + payroll).
 * Mirrors the cadence pattern of `processWorkerAiPrescreenReminders` (due/sent fields, batch scan).
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { resolveWorkerOnboardingLink } from '../integrations/everee/resolveWorkerOnboardingLink';
import {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_PHONE_NUMBER,
  TWILIO_A2P_CAMPAIGN,
} from '../messaging/twilioSecrets';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const BATCH_LIMIT = 200;

const REMINDER_1_MS = 2 * 60 * 60 * 1000;
const REMINDER_2_MS = 24 * 60 * 60 * 1000;
const REMINDER_3_MS = 48 * 60 * 60 * 1000;
/** R4 / R5 are extended-cadence reminders. They only apply to 1099 / events
 *  workers (`entityKey === 'events'`). W2 employments stop at R3 because the
 *  recruiter chases I-9 supporting docs through a separate flow; spamming
 *  "finish your I-9" SMS for a full week was the exact "confusing links"
 *  failure mode that prompted this scheduler tweak. */
const REMINDER_4_MS = 96 * 60 * 60 * 1000;
const REMINDER_5_MS = 168 * 60 * 60 * 1000;

const DUE_KEYS = [
  'onboardingReminder1DueAt',
  'onboardingReminder2DueAt',
  'onboardingReminder3DueAt',
  'onboardingReminder4DueAt',
  'onboardingReminder5DueAt',
] as const;
const SENT_KEYS = [
  'onboardingReminder1SentAt',
  'onboardingReminder2SentAt',
  'onboardingReminder3SentAt',
  'onboardingReminder4SentAt',
  'onboardingReminder5SentAt',
] as const;
type ReminderNumber = 1 | 2 | 3 | 4 | 5;

/** True when the entity is C1 Events (1099 contractors). Used to pick payroll-only
 *  copy + a direct Everee payroll iframe link, and to gate the R4/R5 cadence. */
function isEventsEntityKey(entityKey: unknown): boolean {
  return String(entityKey || '').trim().toLowerCase() === 'events';
}

export function buildOnboardingReminderSmsBody(
  firstName: string,
  link: string,
  lang: 'en' | 'es',
  variant: 'standard' | 'events' = 'standard',
): string {
  const fn = firstName.trim() || 'there';
  const safeLink = String(link || '').trim();
  if (!safeLink) {
    return lang === 'es'
      ? `${fn}, completa tu proceso de incorporación.`
      : `${fn}, please complete your onboarding.`;
  }
  // 1099 workers (today: C1 Events LLC) only need to finish their Everee payroll
  // signup — no I-9 since they're contractors. The standard copy mentioning
  // "I-9 and payroll setup" was actively confusing them. Direct-payroll link
  // also drops them straight into the Everee Embed for the right tenant
  // instead of the My Employment landing page that lists every employment.
  if (variant === 'events') {
    if (lang === 'es') {
      return `Hola ${fn}, este es un recordatorio para completar tu configuración de pago con Everee y poder recibir tu pago.\n\nTermina aquí (toma menos de 5 minutos):\n${safeLink}\n\nResponde si necesitas ayuda.`;
    }
    return `Hi ${fn}, this is a reminder to finish your Everee payroll setup so we can pay you.\n\nFinish here (takes under 5 minutes):\n${safeLink}\n\nReply if you need help.`;
  }
  if (lang === 'es') {
    return `Hola ${fn}, este es un recordatorio para completar tu proceso para próximas oportunidades de trabajo.\n\nPor favor completa tu I-9 y configuración de pago aquí:\n${safeLink}\n\nResponde si necesitas ayuda.`;
  }
  return `Hi ${fn}, this is a reminder to complete your onboarding for upcoming work.\n\nPlease finish your I-9 and payroll setup here:\n${safeLink}\n\nReply if you need help.`;
}

function tenantIdFromEmploymentRef(ref: admin.firestore.DocumentReference): string | null {
  const parts = ref.path.split('/');
  if (parts[0] === 'tenants' && parts.length >= 4 && parts[2] === 'entity_employments') {
    return parts[1];
  }
  return null;
}

function userIdFromPipelineId(pipelineId: string): string | null {
  const idx = pipelineId.indexOf('__');
  if (idx <= 0) return null;
  return pipelineId.slice(0, idx).trim() || null;
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

function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as admin.firestore.Timestamp).toMillis();
  }
  return null;
}

function isPayrollComplete(raw: unknown): boolean {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return s === 'complete' || s === 'completed' || s === 'done';
}

function workerLang(ud: Record<string, unknown>): 'en' | 'es' {
  return String(ud.preferredLanguage || 'en').toLowerCase() === 'es' ? 'es' : 'en';
}

async function tenantAutoRemindersEnabled(tenantId: string): Promise<boolean> {
  try {
    const snap = await db.doc(`tenants/${tenantId}`).get();
    const v = snap.data()?.workerOnboardingAutoRemindersEnabled;
    if (v === false) return false;
  } catch {
    /* fail open */
  }
  return true;
}

async function isI9IncompleteForEmployment(args: {
  tenantId: string;
  userId: string;
  entityId: string | null;
  entityKey: string;
  workerType: string;
}): Promise<boolean> {
  const { tenantId, userId, entityId, entityKey, workerType } = args;
  if (String(entityKey || '').trim().toLowerCase() === 'events') {
    return false;
  }
  if (String(workerType || '').toLowerCase() === '1099') {
    return false;
  }
  if (!entityId || !String(entityId).trim()) {
    return true;
  }
  const eid = String(entityId).trim();
  const snap = await db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`).where('userId', '==', userId).get();
  const forEntity = snap.docs.filter((d) => String((d.data() as { requestedForEntityId?: string }).requestedForEntityId || '').trim() === eid);
  if (forEntity.length === 0) {
    return true;
  }
  return forEntity.some((d) => String((d.data() as { status?: string }).status || '').toLowerCase() !== 'approved');
}

async function hasIncompleteOnboarding(args: {
  tenantId: string;
  userId: string;
  emp: Record<string, unknown>;
}): Promise<boolean> {
  const { tenantId, userId, emp } = args;
  if (emp.onboardingComplete === true) {
    return false;
  }
  const payrollOk = isPayrollComplete(emp.payrollStatus);
  const i9Need = await isI9IncompleteForEmployment({
    tenantId,
    userId,
    entityId: (emp.entityId as string) || null,
    entityKey: String(emp.entityKey || ''),
    workerType: String(emp.workerType || ''),
  });
  if (!payrollOk) {
    return true;
  }
  if (i9Need) {
    return true;
  }
  return false;
}

function scheduleReminderDueFields(
  onCallStartedAt: admin.firestore.Timestamp,
  isEventsEntity: boolean,
): Record<string, unknown> {
  const base = onCallStartedAt.toMillis();
  const fields: Record<string, unknown> = {
    onboardingReminder1DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_1_MS),
    onboardingReminder2DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_2_MS),
    onboardingReminder3DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_3_MS),
  };
  // R4 (4 days) and R5 (7 days) are events-only. Don't write them on W2
  // employments — keeps non-events docs clean and prevents the per-tick
  // sender loop from accidentally firing extended reminders if the entity
  // is later re-classified.
  if (isEventsEntity) {
    fields.onboardingReminder4DueAt = admin.firestore.Timestamp.fromMillis(base + REMINDER_4_MS);
    fields.onboardingReminder5DueAt = admin.firestore.Timestamp.fromMillis(base + REMINDER_5_MS);
  }
  return fields;
}

async function writeAudit(args: {
  tenantId: string;
  userId: string;
  entityEmploymentId: string;
  reminderNumber: ReminderNumber;
  success: boolean;
  error?: string;
}): Promise<void> {
  try {
    await db.collection(`tenants/${args.tenantId}/onboarding_reminder_audit`).add({
      userId: args.userId,
      entityEmploymentId: args.entityEmploymentId,
      reminderNumber: args.reminderNumber,
      messageType: 'onboarding_reminder',
      success: args.success,
      error: args.error ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e: unknown) {
    logger.warn('onboarding_reminder_audit write failed', {
      tenantId: args.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function sendOnboardingReminderSms(args: {
  tenantId: string;
  userId: string;
  pipelineId: string;
  reminderNumber: ReminderNumber;
  userData: Record<string, unknown>;
  emp: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const { tenantId, userId, pipelineId, userData, emp } = args;

  // URL: prefer the direct Everee payroll embed for any Everee-enabled
  // entity (C1 Events 1099 OR C1 Select W2 OR future entities) — Everee
  // surfaces I-9 + W-4 + W-9 + banking inside its iframe so it's strictly
  // fewer hops than the My Employment hub. Falls back to the hub URL when
  // the entity isn't on Everee at all.
  //
  // Body wording: still gated on `entityKey === 'events'` so 1099 copy
  // doesn't say "I-9 and payroll" — that's the W2-specific phrasing.
  const eventsEntity = isEventsEntityKey(emp.entityKey);
  const variant: 'standard' | 'events' = eventsEntity ? 'events' : 'standard';
  const { link } = await resolveWorkerOnboardingLink({
    tenantId,
    entityId: (emp.entityId as string) || null,
    pipelineId,
    context: 'processWorkerOnboardingReminders',
  });
  if (!link) {
    return { success: false, error: 'missing_worker_entity_url' };
  }
  if (!userDocHasUsablePhone(userData)) {
    return { success: false, error: 'no_usable_phone' };
  }
  const phone = phoneE164FromUser(userData);
  if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    return { success: false, error: 'invalid_e164' };
  }
  const lang = workerLang(userData);
  const fn = firstNameFromUser(userData);
  const body = buildOnboardingReminderSmsBody(fn, link, lang, variant);
  const result = await sendWorkerMessageInternal(phone, body, {
    systemContext: true,
    tenantId,
    userId,
    messageTypeId: 'onboarding_reminder',
    source: 'onboarding_reminder_scheduler',
    sourceId: `${pipelineId}__r${args.reminderNumber}`,
  });
  if (!result.success) {
    return { success: false, error: result.error || result.status };
  }
  return { success: true };
}

export const processWorkerOnboardingReminders = onSchedule(
  {
    // Cadence rationale: reminders fire at 2h / 24h / 48h offsets from
    // `onCallStartedAt` for every entity. With a 60-min tick, worst-case
    // R1 latency is 2:00-3:00h and R2/R3 are 24:00-25:00h / 48:00-49:00h
    // — well within "feels human" timing for an "complete your I-9 +
    // payroll setup" reminder. Down from the prior 10-min cadence to
    // reduce scheduler invocation cost. Sibling reminder schedulers
    // (`processApplyWizardReminders`, `processScheduledInterviewInvites`)
    // keep their 10-min / 5-min cadences because their reminder offsets
    // are 15 min — relative variance would balloon.
    //
    // Events extension: events / 1099 employments (today: C1 Events LLC)
    // additionally fire R4 @ 96h (4 days) and R5 @ 168h (7 days). Everee
    // payroll signup is the only thing they need to finish, the link
    // changes are a bigger UX win (see `sendOnboardingReminderSms` for
    // direct-payroll URL handling), and operators were watching workers
    // sit in `Onboarding` past the 48h R3 cutoff with no further nudges.
    // W2 employments are intentionally still capped at R3 — recruiters
    // chase I-9 supporting docs via a separate dedicated flow, and a
    // week of "finish your I-9" SMS would be net-negative.
    //
    // BI.0 / BI.1 note: stock onboarding reminders ARE relevant to
    // migration workers (they need to complete I-9 + payroll on Everee
    // post-import). The migration framing message is sent separately
    // via `.scratch/sendMigrationMessages.ts` after the import lands;
    // these stock reminders are the implementation follow-ups. So this
    // scheduler intentionally has NO `userIsInActiveMigration` gate —
    // unlike `dispatchWorkerHired` /
    // `dispatchWorkerOnboardingPipelineStarted` which are new-applicant
    // / hire-announcement surfaces that don't fit migration context.
    schedule: 'every 60 minutes',
    timeZone: 'America/Los_Angeles',
    region: 'us-central1',
    memory: '512MiB',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
    timeoutSeconds: 300,
  },
  async () => {
    const now = Date.now();
    let q: admin.firestore.QuerySnapshot;
    try {
      q = await db
        .collectionGroup('entity_employments')
        .where('onboardingPhase', '==', 'in_progress')
        .where('employmentEntryMode', '==', 'on_call_pool')
        .limit(BATCH_LIMIT)
        .get();
    } catch (err: unknown) {
      logger.error('processWorkerOnboardingReminders: query failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (q.empty) {
      return;
    }

    let initCount = 0;
    let sent = 0;
    let errors = 0;

    for (const docSnap of q.docs) {
      const tenantId = tenantIdFromEmploymentRef(docSnap.ref);
      const pipelineId = docSnap.id;
      if (!tenantId) {
        continue;
      }

      if (!(await tenantAutoRemindersEnabled(tenantId))) {
        continue;
      }

      let emp = { ...(docSnap.data() as Record<string, unknown>) };

      const onCallStartedAt = emp.onCallStartedAt as admin.firestore.Timestamp | undefined;
      if (!onCallStartedAt) {
        continue;
      }

      const userId = userIdFromPipelineId(pipelineId) || String(emp.userId || '').trim();
      if (!userId) {
        continue;
      }

      if (emp.onboardingComplete === true) {
        continue;
      }

      const eventsEntity = isEventsEntityKey(emp.entityKey);
      const r1Due = tsMillis(emp.onboardingReminder1DueAt);
      // First-time init writes R1-R3 always, R4-R5 only for events. We also
      // backfill R4/R5 on the next pass for events employments that were
      // initialized before the extended cadence shipped — without this,
      // already-stuck workers like the C1 Events backlog would never get the
      // 4-day or 7-day pings even after the deploy lands.
      const needsExtendedInit =
        eventsEntity &&
        r1Due != null &&
        emp.onboardingReminder4DueAt == null;
      if (r1Due == null || needsExtendedInit) {
        await docSnap.ref.set(
          {
            ...scheduleReminderDueFields(onCallStartedAt, eventsEntity),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        initCount += 1;
        const fresh = await docSnap.ref.get();
        emp = { ...(fresh.data() as Record<string, unknown>) };
      }

      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) {
        continue;
      }
      const userData = (userSnap.data() || {}) as Record<string, unknown>;

      const incomplete = await hasIncompleteOnboarding({ tenantId, userId, emp });
      if (!incomplete) {
        continue;
      }

      // R4/R5 are events-only. Capping the loop at 3 for non-events
      // preserves the original 2h/24h/48h W2 cadence even though the
      // DUE_KEYS / SENT_KEYS arrays are sized for 5.
      const maxReminderIndex = eventsEntity ? 5 : 3;
      /** At most one reminder attempt per employment per tick (first due unsent: 1 → 2 → 3 → events 4 → 5). */
      for (let i = 0; i < maxReminderIndex; i += 1) {
        const reminderNum = (i + 1) as ReminderNumber;
        const dueKey = DUE_KEYS[i];
        const sentKey = SENT_KEYS[i];
        const dueMs = tsMillis(emp[dueKey]);
        if (dueMs == null || dueMs > now) {
          continue;
        }
        if (emp[sentKey]) {
          continue;
        }

        const sendResult = await sendOnboardingReminderSms({
          tenantId,
          userId,
          pipelineId,
          reminderNumber: reminderNum,
          userData,
          emp,
        });

        if (sendResult.success) {
          await docSnap.ref.set(
            {
              [sentKey]: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
          emp[sentKey] = true;
          sent += 1;
          await writeAudit({
            tenantId,
            userId,
            entityEmploymentId: pipelineId,
            reminderNumber: reminderNum,
            success: true,
          });
        } else {
          errors += 1;
          await writeAudit({
            tenantId,
            userId,
            entityEmploymentId: pipelineId,
            reminderNumber: reminderNum,
            success: false,
            error: sendResult.error,
          });
        }
        break;
      }
    }

    if (initCount || sent || errors) {
      logger.info('processWorkerOnboardingReminders tick', {
        scanned: q.size,
        initSchedules: initCount,
        sent,
        errors,
      });
    }
  },
);
