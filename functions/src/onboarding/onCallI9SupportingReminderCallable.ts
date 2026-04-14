/**
 * Preview-first admin tool: SMS reminders for W-2 workers who still need to upload I-9 supporting docs.
 * - `on_call_pool`: only `entity_employments` with `employmentEntryMode === 'on_call_pool'`.
 * - `all_w2_onboarding`: all W-2 employments in onboarding (not phase complete), up to 2500 docs scanned (temporary bulk op).
 *
 * Source of truth: `entity_employments` + `worker_i9_supporting_documents` (per entity) + cooldown on employment row.
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
import { buildWorkerEntityEmploymentUrl } from '../utils/workerUrls';
import { userDocHasUsablePhone } from '../workerAiPrescreen/evaluateAiPrescreenEligibility';
import { isI9DocumentSetComplete, type I9DocRowLike } from '../utils/i9SupportingDocumentCompletion';
import { resolveWorkerSmsLang } from './i9SupportingReviewNotifications';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const TERMINAL_EMPLOYMENT_STATUS = new Set(['terminated', 'inactive']);

function norm(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase();
}

function tsMillis(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'object' && v !== null && 'toMillis' in v && typeof (v as { toMillis: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

function normalizeOnboardingPhase(raw: unknown): 'not_started' | 'in_progress' | 'complete' | 'unknown' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return 'unknown';
  if (s === 'not_started' || s === 'none') return 'not_started';
  if (s === 'in_progress' || s === 'onboarding') return 'in_progress';
  if (s === 'complete' || s === 'completed' || s === 'done') return 'complete';
  return 'unknown';
}

function displayNameFromUser(data: Record<string, unknown>): string {
  const d = String(data.displayName || '').trim();
  if (d) return d;
  const fn = String(data.firstName || '').trim();
  const ln = String(data.lastName || '').trim();
  const j = [fn, ln].filter(Boolean).join(' ');
  return j || '—';
}

function firstNameForSms(data: Record<string, unknown>): string {
  const firstRaw = String(data.firstName || data.preferredFirstName || '').trim();
  return firstRaw ? firstRaw.split(/\s+/)[0] : '';
}

function greetingHi(firstName: string, lang: 'en' | 'es'): string {
  if (!firstName) return lang === 'es' ? 'Hola, ' : 'Hi, ';
  return lang === 'es' ? `Hola ${firstName}, ` : `Hi ${firstName}, `;
}

/** Rows for this entity employment (I-9 supporting docs are keyed by requestedForEntityId). */
function filterI9RowsForEntity(
  allDocs: Array<{ id: string; data: Record<string, unknown> }>,
  entityId: string,
): I9DocRowLike[] {
  const eid = String(entityId || '').trim();
  const out: I9DocRowLike[] = [];
  for (const { data } of allDocs) {
    const req = String(data.requestedForEntityId || '').trim();
    if (req && req !== eid) continue;
    out.push({
      documentType: String(data.documentType || ''),
      status: String(data.status || ''),
    });
  }
  return out;
}

function enrichRowsWithStorage(
  allDocs: Array<{ data: Record<string, unknown> }>,
  entityId: string,
): Array<I9DocRowLike & { storagePath?: string }> {
  const eid = String(entityId || '').trim();
  const out: Array<I9DocRowLike & { storagePath?: string }> = [];
  for (const { data } of allDocs) {
    const req = String(data.requestedForEntityId || '').trim();
    if (req && req !== eid) continue;
    out.push({
      documentType: String(data.documentType || ''),
      status: String(data.status || ''),
      storagePath: String(data.storagePath || ''),
    });
  }
  return out;
}

/**
 * True if worker still needs to upload or replace something (not stuck only in pending_review with full sets awaiting HR).
 */
function needsWorkerI9UploadAction(rows: Array<I9DocRowLike & { storagePath?: string }>): boolean {
  if (isI9DocumentSetComplete(rows)) return false;
  if (rows.length === 0) return true;
  for (const r of rows) {
    const st = norm(r.status);
    if (st === 'rejected') return true;
    if (st === 'awaiting_upload' && !String(r.storagePath || '').trim()) return true;
  }
  return false;
}

function buildReminderBody(firstName: string, lang: 'en' | 'es', link: string | null): { body: string; templateKey: 'with_link' | 'no_link' } {
  const hi = greetingHi(firstName, lang);
  if (link) {
    if (lang === 'es') {
      return {
        body: `${hi}Te recordamos subir tus documentos I-9 si aún no lo has hecho. Complétalo aquí: ${link}. Responde si necesitas ayuda.`,
        templateKey: 'with_link',
      };
    }
    return {
      body: `${hi}This is a reminder to upload your I-9 documents if you have not already done so. Please complete this here: ${link}. Reply if you need help.`,
      templateKey: 'with_link',
    };
  }
  if (lang === 'es') {
    return {
      body: `${hi}Te recordamos subir tus documentos I-9 si aún no lo has hecho. Usa el enlace de incorporación en cuanto puedas. Responde si necesitas ayuda.`,
      templateKey: 'no_link',
    };
  }
  return {
    body: `${hi}This is a reminder to upload your I-9 documents if you have not already done so. Please use your onboarding link to complete this step as soon as possible. Reply if you need help.`,
    templateKey: 'no_link',
  };
}

export type OnCallI9SupportingReminderIncluded = {
  userId: string;
  pipelineId: string;
  entityId: string | null;
  displayName: string;
  warnings: string[];
  directUploadLink: string | null;
};

export type OnCallI9SupportingReminderExcluded = {
  userId: string;
  pipelineId: string | null;
  displayName: string;
  reason: string;
};

export type OnCallI9SupportingReminderSendResult = {
  userId: string;
  pipelineId: string;
  success: boolean;
  error?: string;
  /** Same user had another employment earlier in this batch — SMS already sent; cooldown still applied here. */
  duplicateSkipped?: boolean;
};

export type I9UploadReminderAudience = 'on_call_pool' | 'all_w2_onboarding';

export type OnCallI9SupportingReminderResult = {
  tenantId: string;
  mode: 'preview' | 'send';
  audience: I9UploadReminderAudience;
  cooldownHours: number;
  employmentDocsScanned: number;
  included: OnCallI9SupportingReminderIncluded[];
  excluded: OnCallI9SupportingReminderExcluded[];
  sendResults?: OnCallI9SupportingReminderSendResult[];
  auditId: string | null;
  note: string;
};

const MAX_MASTER_EMPLOYMENT_SCAN = 2500;
const ON_CALL_EMPLOYMENT_LIMIT = 500;

export const onCallI9SupportingReminder = onCall(
  {
    enforceAppCheck: false,
    cors: CALLABLE_BROWSER_CORS,
    memory: '1GiB',
    timeoutSeconds: 300,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_PHONE_NUMBER, TWILIO_A2P_CAMPAIGN],
  },
  async (request): Promise<OnCallI9SupportingReminderResult> => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const raw = (request.data || {}) as { tenantId?: unknown; mode?: unknown; cooldownHours?: unknown; audience?: unknown };
    const tenantId = typeof raw.tenantId === 'string' ? raw.tenantId.trim() : '';
    const mode = raw.mode === 'send' ? 'send' : 'preview';
    const audience: I9UploadReminderAudience =
      raw.audience === 'all_w2_onboarding' ? 'all_w2_onboarding' : 'on_call_pool';
    const cooldownHours =
      typeof raw.cooldownHours === 'number' && Number.isFinite(raw.cooldownHours) && raw.cooldownHours >= 1
        ? Math.min(Math.floor(raw.cooldownHours), 168)
        : 72;
    const cooldownMs = cooldownHours * 60 * 60 * 1000;

    if (!tenantId) {
      throw new HttpsError('invalid-argument', 'tenantId is required');
    }
    if (!(await canManageOnboarding(request.auth, tenantId, request.auth.uid))) {
      throw new HttpsError('permission-denied', 'Not authorized for this tenant');
    }

    const empCol = db.collection(`tenants/${tenantId}/entity_employments`);
    const empSnap =
      audience === 'all_w2_onboarding'
        ? await empCol.limit(MAX_MASTER_EMPLOYMENT_SCAN).get()
        : await empCol.where('employmentEntryMode', '==', 'on_call_pool').limit(ON_CALL_EMPLOYMENT_LIMIT).get();

    const included: OnCallI9SupportingReminderIncluded[] = [];
    const excluded: OnCallI9SupportingReminderExcluded[] = [];
    const sendResults: OnCallI9SupportingReminderSendResult[] = [];

    /** At most one SMS per user per invocation (multiple entity employments may qualify). */
    const userIdsSentSmsThisBatch = new Set<string>();
    /** Preview: warn when the same user would appear on multiple included rows. */
    const previewUserIdsSeen = new Set<string>();

    /** Dedupe by userId+pipelineId: one row per employment doc */
    const seenPipeline = new Set<string>();

    for (const ed of empSnap.docs) {
      const pipelineId = ed.id;
      if (seenPipeline.has(pipelineId)) continue;
      seenPipeline.add(pipelineId);

      const emp = ed.data() as Record<string, unknown>;
      const userId = String(emp.userId || '').trim();
      const entityId = String(emp.entityId || '').trim() || null;
      const entityKey = String(emp.entityKey || '').trim().toLowerCase();
      const workerType = norm(emp.workerType);
      const empStatus = norm(emp.status || emp.employmentState);
      const phase = normalizeOnboardingPhase(emp.onboardingPhase);

      let displayName = '—';

      if (!userId) {
        excluded.push({ userId: '', pipelineId, displayName: '—', reason: 'Missing userId on employment record' });
        continue;
      }

      const userSnap = await db.doc(`users/${userId}`).get();
      if (!userSnap.exists) {
        excluded.push({ userId, pipelineId, displayName: '—', reason: 'User document not found' });
        continue;
      }
      const userData = userSnap.data() as Record<string, unknown>;
      displayName = displayNameFromUser(userData);

      if (entityKey === 'events') {
        excluded.push({ userId, pipelineId, displayName, reason: 'C1 Events entity — I-9 supporting flow not used' });
        continue;
      }

      if (workerType === '1099') {
        excluded.push({ userId, pipelineId, displayName, reason: '1099 / contractor — I-9 supporting uploads not applicable' });
        continue;
      }

      if (workerType !== 'w2') {
        excluded.push({ userId, pipelineId, displayName, reason: `Worker type not W-2 (${workerType || 'unknown'})` });
        continue;
      }

      if (TERMINAL_EMPLOYMENT_STATUS.has(empStatus)) {
        excluded.push({ userId, pipelineId, displayName, reason: `Employment status terminal (${empStatus})` });
        continue;
      }

      if (phase === 'complete') {
        excluded.push({ userId, pipelineId, displayName, reason: 'Onboarding phase complete on employment record' });
        continue;
      }

      const lastSent = tsMillis(emp.i9SupportingUploadReminderLastSentAt);
      if (lastSent != null && Date.now() - lastSent < cooldownMs) {
        excluded.push({
          userId,
          pipelineId,
          displayName,
          reason: `Reminder within cooldown (${cooldownHours}h) — i9SupportingUploadReminderLastSentAt`,
        });
        continue;
      }

      if (!userDocHasUsablePhone(userData)) {
        excluded.push({ userId, pipelineId, displayName, reason: 'No usable SMS phone (phoneE164 / phone)' });
        continue;
      }

      const phone = String(userData.phoneE164 || '').trim();
      if (!phone || !/^\+[1-9]\d{7,14}$/.test(phone)) {
        excluded.push({ userId, pipelineId, displayName, reason: 'Phone not in E.164 for SMS' });
        continue;
      }

      const i9Col = db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`);
      const i9Snap = await i9Col.where('userId', '==', userId).limit(80).get();
      const allRows = i9Snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));

      if (!entityId) {
        excluded.push({ userId, pipelineId, displayName, reason: 'Employment missing entityId — cannot scope I-9 rows' });
        continue;
      }

      const scoped = filterI9RowsForEntity(allRows, entityId);
      const scopedWithStorage = enrichRowsWithStorage(allRows, entityId);

      if (isI9DocumentSetComplete(scoped)) {
        excluded.push({ userId, pipelineId, displayName, reason: 'I-9 supporting document set already complete (approved List A or B+C)' });
        continue;
      }

      if (!needsWorkerI9UploadAction(scopedWithStorage)) {
        excluded.push({
          userId,
          pipelineId,
          displayName,
          reason: 'I-9 uploads in progress — awaiting staff review only (no worker upload/reupload pending)',
        });
        continue;
      }

      const warnings: string[] = [];
      const pr = tsMillis(userData.profileUpdateReminderLastSentAt);
      if (pr != null && Date.now() - pr < 7 * 24 * 60 * 60 * 1000) {
        warnings.push('profileUpdateReminderLastSentAt within 7 days (informational)');
      }

      const link = buildWorkerEntityEmploymentUrl(pipelineId) || null;

      if (mode === 'preview') {
        if (previewUserIdsSeen.has(userId)) {
          warnings.push('Another employment for this user appears earlier in scan — Send will SMS once per user per run.');
        } else {
          previewUserIdsSeen.add(userId);
        }
      }

      included.push({
        userId,
        pipelineId,
        entityId,
        displayName,
        warnings,
        directUploadLink: link,
      });

      if (mode === 'send') {
        if (userIdsSentSmsThisBatch.has(userId)) {
          sendResults.push({
            userId,
            pipelineId,
            success: true,
            duplicateSkipped: true,
          });
          await ed.ref.set(
            {
              i9SupportingUploadReminderLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
              i9SupportingUploadReminderLastSentByUid: request.auth.uid,
            },
            { merge: true },
          );
        } else {
          const lang = resolveWorkerSmsLang(userData);
          const fn = firstNameForSms(userData);
          const { body } = buildReminderBody(fn, lang, link);
          const result = await sendWorkerMessageInternal(phone, body, {
            systemContext: true,
            source:
              audience === 'all_w2_onboarding' ? 'i9_supporting_upload_reminder_all_onboarding' : 'on_call_i9_supporting_reminder',
            tenantId,
            userId,
          });
          sendResults.push({
            userId,
            pipelineId,
            success: result.success,
            ...(result.error ? { error: result.error } : {}),
          });
          if (result.success) {
            userIdsSentSmsThisBatch.add(userId);
            await ed.ref.set(
              {
                i9SupportingUploadReminderLastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                i9SupportingUploadReminderLastSentByUid: request.auth.uid,
              },
              { merge: true },
            );
          } else {
            logger.warn('on_call_i9_reminder.sms_failed', { userId, pipelineId, err: result.error });
          }
        }
      }
    }

    let auditId: string | null = null;
    if (mode === 'send') {
      const ref = db.collection(`tenants/${tenantId}/onboarding_i9_reminder_audit`).doc();
      auditId = ref.id;
      await ref.set({
        type: 'i9_supporting_upload_reminder',
        reminderAudience: audience,
        tenantId,
        mode: 'send',
        cooldownHours,
        performedByUid: request.auth.uid,
        performedAt: admin.firestore.FieldValue.serverTimestamp(),
        employmentDocsScanned: empSnap.size,
        includedUserIds: included.map((r) => r.userId),
        includedPipelineIds: included.map((r) => r.pipelineId),
        excluded: excluded.map((e) => ({ ...e })),
        sendResults,
        smsDispatchedCount: sendResults.filter((s) => s.success && !s.duplicateSkipped).length,
        messageNote: 'SMS via sendWorkerMessageInternal; bilingual via users.preferredLanguage (en|es); at most one SMS per user per run',
      });
      const smsDispatched = sendResults.filter((s) => s.success && !s.duplicateSkipped).length;
      logger.info('onboarding_i9_reminder_audit', { tenantId, auditId, smsDispatched, rows: sendResults.length });
    }

    const truncated =
      audience === 'all_w2_onboarding' && empSnap.size >= MAX_MASTER_EMPLOYMENT_SCAN
        ? ` Scanned max ${MAX_MASTER_EMPLOYMENT_SCAN} entity_employments; larger tenants may need a follow-up run or query pagination.`
        : '';

    return {
      tenantId,
      mode,
      audience,
      cooldownHours,
      employmentDocsScanned: empSnap.size,
      included,
      excluded,
      ...(mode === 'send' ? { sendResults } : {}),
      auditId,
      note:
        (mode === 'preview'
          ? 'Preview only — no SMS sent. Use mode send to deliver and write audit + per-employment cooldown timestamps.'
          : 'Send complete — audit log written under tenants/{tenantId}/onboarding_i9_reminder_audit.') +
        (audience === 'all_w2_onboarding'
          ? ` Audience: all W-2 employments still in onboarding (not phase complete), not only on-call pool.${truncated}`
          : ' Audience: on-call pool employments only.'),
    };
  },
);
