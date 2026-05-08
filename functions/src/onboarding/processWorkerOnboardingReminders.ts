/**
 * Scheduled: automated SMS reminders for on-call workers with incomplete onboarding (I-9 + payroll).
 * Mirrors the cadence pattern of `processWorkerAiPrescreenReminders` (due/sent fields, batch scan).
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from '../twilio';
import { userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { buildWorkerEntityEmploymentUrl } from '../utils/workerUrls';
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

const DUE_KEYS = [
  'onboardingReminder1DueAt',
  'onboardingReminder2DueAt',
  'onboardingReminder3DueAt',
] as const;
const SENT_KEYS = [
  'onboardingReminder1SentAt',
  'onboardingReminder2SentAt',
  'onboardingReminder3SentAt',
] as const;

export function buildOnboardingReminderSmsBody(firstName: string, link: string, lang: 'en' | 'es'): string {
  const fn = firstName.trim() || 'there';
  const safeLink = String(link || '').trim();
  if (!safeLink) {
    return lang === 'es'
      ? `${fn}, completa tu proceso de incorporación.`
      : `${fn}, please complete your onboarding.`;
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

function scheduleReminderDueFields(onCallStartedAt: admin.firestore.Timestamp): Record<string, unknown> {
  const base = onCallStartedAt.toMillis();
  return {
    onboardingReminder1DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_1_MS),
    onboardingReminder2DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_2_MS),
    onboardingReminder3DueAt: admin.firestore.Timestamp.fromMillis(base + REMINDER_3_MS),
  };
}

async function writeAudit(args: {
  tenantId: string;
  userId: string;
  entityEmploymentId: string;
  reminderNumber: 1 | 2 | 3;
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
  reminderNumber: 1 | 2 | 3;
  userData: Record<string, unknown>;
}): Promise<{ success: boolean; error?: string }> {
  const { tenantId, userId, pipelineId, userData } = args;
  const link = buildWorkerEntityEmploymentUrl(pipelineId);
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
  const body = buildOnboardingReminderSmsBody(fn, link, lang);
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
    // `onCallStartedAt`. With a 60-min tick, worst-case R1 latency is
    // 2:00-3:00h and R2/R3 are 24:00-25:00h / 48:00-49:00h — well within
    // "feels human" timing for an "complete your I-9 + payroll setup"
    // reminder. Down from the prior 10-min cadence to reduce scheduler
    // invocation cost. Sibling reminder schedulers
    // (`processApplyWizardReminders`, `processScheduledInterviewInvites`)
    // keep their 10-min / 5-min cadences because their reminder offsets
    // are 15 min — relative variance would balloon.
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

      const r1Due = tsMillis(emp.onboardingReminder1DueAt);
      if (r1Due == null) {
        await docSnap.ref.set(
          {
            ...scheduleReminderDueFields(onCallStartedAt),
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

      /** At most one reminder attempt per employment per tick (first due unsent: 1 → 2 → 3). */
      for (let i = 0; i < 3; i += 1) {
        const reminderNum = (i + 1) as 1 | 2 | 3;
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
