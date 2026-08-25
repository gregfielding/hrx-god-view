/**
 * Account-deletion grace sweep (Greg approved 2026-08-25).
 *
 * Workers request deletion at /c1 profile → `account_deletion_requests/{uid}`
 * (doc id = uid, status 'pending'). Previously every request needed a manual
 * admin click. This sweep automates the no-payroll case:
 *
 *   pending + account already gone      → auto-complete (server-side self-heal,
 *                                         mirrors DeletionRequestsPage's load)
 *   pending + payroll history or staff  → NEVER auto-deleted; left pending for
 *                                         a human (retention rule: real pay
 *                                         history is deactivate+retain)
 *   pending + eligible, no notice yet   → SMS + in-app notice, stamp
 *                                         graceNoticeSentAt / scheduledDeletionAt
 *                                         (now + 7 days) / phoneE164AtNotice
 *   pending + grace elapsed             → recursiveDelete(users/{uid}) + Auth
 *                                         delete (mirrors deleteUserCompletely),
 *                                         request → completed
 *                                         'auto (grace elapsed)', farewell SMS
 *
 * NOT a Cloud Function (Cloud Run 1,000-service cap) — called from the daily
 * `processApplyAbandonNudges` cron (17:00 UTC: daylight SMS window, Twilio
 * secrets already bound). Grace stamps make re-runs idempotent. New fields are
 * admin-SDK writes; firestore.rules' client-update allowlist is untouched.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { sendWorkerMessageInternal } from './twilio';
import { sendNotificationAndPush } from './messaging/unifiedWorkerNotifications';

const db = admin.firestore();

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DELETES_PER_RUN = 20;

function trim(v: unknown): string {
  return String(v ?? '').trim();
}

function phoneE164FromUser(data: Record<string, unknown>): string {
  const e = trim(data.phoneE164);
  if (/^\+[1-9]\d{7,14}$/.test(e)) return e;
  const digits = trim(data.phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

/** Retention rule — same markers as DeletionRequestsPage's red chip. */
function hasPayrollHistory(u: Record<string, unknown>): boolean {
  const tax = (u.taxIdentity ?? null) as Record<string, unknown> | null;
  return trim(tax?.source) === 'everee' || Boolean(trim(u.evereeWorkerId));
}

/** Staff accounts are never auto-deleted, whatever the request says. */
function isStaffLevel(u: Record<string, unknown>): boolean {
  const top = parseInt(trim(u.securityLevel) || '0', 10);
  if (Number.isFinite(top) && top >= 5) return true;
  const tenantIds = (u.tenantIds ?? null) as Record<string, { securityLevel?: unknown }> | null;
  if (tenantIds && typeof tenantIds === 'object') {
    for (const entry of Object.values(tenantIds)) {
      const lvl = parseInt(trim(entry?.securityLevel) || '0', 10);
      if (Number.isFinite(lvl) && lvl >= 5) return true;
    }
  }
  return false;
}

function fmtDate(ms: number, es: boolean): string {
  const d = new Date(ms);
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return es ? `${day}/${m}` : `${m}/${day}`;
}

/** Injectable for scratch verification only — the laptop admin-SDK Auth
 *  footgun (auth/internal-error on ALL local Auth ops) makes the default
 *  untestable off-runtime. Production always uses the default. */
export async function runAccountDeletionGraceSweep(deps?: {
  deleteAuthUser?: (uid: string) => Promise<void>;
}): Promise<void> {
  const deleteAuthUser =
    deps?.deleteAuthUser ??
    (async (uid: string) => {
      try {
        await admin.auth().deleteUser(uid);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code !== 'auth/user-not-found') throw e;
      }
    });
  const now = Date.now();
  const pending = await db
    .collection('account_deletion_requests')
    .where('status', '==', 'pending')
    .limit(100)
    .get();
  if (pending.empty) return;

  let noticed = 0;
  let deleted = 0;
  let healed = 0;
  let held = 0;

  for (const reqSnap of pending.docs) {
    const uid = reqSnap.id;
    try {
      const userSnap = await db.collection('users').doc(uid).get();

      // Account already gone (admin deleted it some other way) — complete.
      if (!userSnap.exists) {
        await reqSnap.ref.update({
          status: 'completed',
          processedBy: 'auto (account deleted)',
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          note: 'Auto-completed: account no longer exists.',
        });
        healed += 1;
        continue;
      }

      const u = userSnap.data() as Record<string, unknown>;
      if (hasPayrollHistory(u) || isStaffLevel(u)) {
        held += 1; // stays pending for a human — the queue chips explain why
        continue;
      }

      const es = trim(u.preferredLanguage) === 'es';
      const noticeSent = Boolean(reqSnap.get('graceNoticeSentAt'));

      if (!noticeSent) {
        const deleteAtMs = now + GRACE_MS;
        const phone = phoneE164FromUser(u);
        const dateStr = fmtDate(deleteAtMs, es);
        if (phone && u.smsOptIn !== false) {
          const body = es
            ? `C1 Staffing: recibimos tu solicitud para eliminar tu cuenta. Se eliminará permanentemente el ${dateStr}. Si cambiaste de opinión, responde a este mensaje.`
            : `C1 Staffing: we received your request to delete your account. It will be permanently deleted on ${dateStr}. If you've changed your mind, just reply to this message.`;
          try {
            await sendWorkerMessageInternal(phone, body, {
              systemContext: true,
              source: 'system',
              sourceId: uid,
              messageTypeId: 'account_deletion_notice',
              userId: uid,
            });
          } catch (e) {
            logger.warn('deletionGraceSweep: notice SMS failed', { uid, error: String(e) });
          }
        }
        try {
          await sendNotificationAndPush({
            uid,
            tenantId: trim(u.activeTenantId) || trim(u.tenantId) || 'BCiP2bQ9CgVOCTfV6MhD',
            title: es ? 'Solicitud de eliminación recibida' : 'Deletion request received',
            body: es
              ? `Tu cuenta se eliminará permanentemente el ${dateStr}.`
              : `Your account will be permanently deleted on ${dateStr}.`,
            type: 'support',
            category: 'system',
            source: 'system',
          });
        } catch (e) {
          logger.warn('deletionGraceSweep: notice push failed', { uid, error: String(e) });
        }
        await reqSnap.ref.update({
          graceNoticeSentAt: admin.firestore.FieldValue.serverTimestamp(),
          scheduledDeletionAt: admin.firestore.Timestamp.fromMillis(deleteAtMs),
          // Captured now — the users doc (and its phone) is gone by farewell time.
          phoneE164AtNotice: phone || null,
          preferredLanguageAtNotice: es ? 'es' : 'en',
        });
        noticed += 1;
        continue;
      }

      const schedAt = reqSnap.get('scheduledDeletionAt') as admin.firestore.Timestamp | undefined;
      if (!schedAt || schedAt.toMillis() > now) continue; // still in grace
      if (deleted >= MAX_DELETES_PER_RUN) continue;

      // Grace elapsed — delete (mirrors deleteUserCompletely, but tolerates a
      // missing Auth user so a partial prior run can't wedge the request).
      await db.recursiveDelete(userSnap.ref);
      await deleteAuthUser(uid);
      await reqSnap.ref.update({
        status: 'completed',
        processedBy: 'auto (grace elapsed)',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        note: `Auto-deleted after 7-day grace — no payroll history. Notice sent ${
          (reqSnap.get('graceNoticeSentAt') as admin.firestore.Timestamp | undefined)
            ?.toDate()
            .toISOString()
            .slice(0, 10) ?? 'earlier'
        }.`,
      });
      const farewellPhone = trim(reqSnap.get('phoneE164AtNotice'));
      if (farewellPhone) {
        const esNote = trim(reqSnap.get('preferredLanguageAtNotice')) === 'es';
        try {
          await sendWorkerMessageInternal(
            farewellPhone,
            esNote
              ? 'C1 Staffing: tu cuenta ha sido eliminada como solicitaste. Gracias — siempre serás bienvenido de vuelta.'
              : "C1 Staffing: your account has been deleted as you requested. Thank you — you're always welcome back.",
            {
              systemContext: true,
              source: 'system',
              sourceId: uid,
              messageTypeId: 'account_deletion_done',
            },
          );
        } catch (e) {
          logger.warn('deletionGraceSweep: farewell SMS failed', { uid, error: String(e) });
        }
      }
      deleted += 1;
    } catch (e) {
      logger.error('deletionGraceSweep: request failed', { uid, error: String(e) });
    }
  }

  logger.info('deletionGraceSweep: run done', {
    pending: pending.size,
    noticed,
    deleted,
    healed,
    heldForHuman: held,
  });
}
