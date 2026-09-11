/**
 * SMS delivery alerts (2026-09-07, Greg: "add a Slack alert on error 21610").
 *
 * Twilio error 21610 = "Attempt to send to unsubscribed recipient": the
 * worker texted an opt-out keyword to our number and Twilio now drops every
 * send. Until 2026-09-07 this was invisible — the cadence asked workers to
 * reply CANCEL, which was on Twilio's default opt-out list, and 3+ workers
 * silently went dark (see docs/claude/feedback_twilio_cancel_keyword_optout.md).
 *
 * Two halves, deliberately decoupled so the SMS senders (called from dozens
 * of functions) never need the Slack secret:
 *   1. `recordSmsCarrierBlock` — called by the senders on 21610. Stamps the
 *      user (`smsBlockedSystem: true` so HRX stops trying, + carrier-block
 *      fields so the UI/START handler can explain and clear it) and upserts
 *      a `tenants/{t}/ops_alerts/{key}` doc (one per worker per day).
 *   2. `drainOpsAlertsToSlack` — called by an already-scheduled function that
 *      binds SLACK_BOT_TOKEN (dispatchScheduledWorkerReminders, every 5 min).
 *      Posts pending alerts to `app_config/ops_alerts.slackChannelId` and
 *      marks them posted. Fail-open everywhere: alerts are a mirror, never a
 *      dependency of sending.
 */
import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const TWILIO_UNSUBSCRIBED_RECIPIENT = '21610';
/** Twilio: "Invalid 'To' phone number" — the number on file can never receive SMS. */
export const TWILIO_INVALID_TO = '21211';
/** Twilio: "'To' number is not a valid mobile number" (landline / VoIP without SMS). */
export const TWILIO_NOT_SMS_CAPABLE = '21614';

/**
 * Error codes after which retrying the SAME number is pointless. Crons that
 * defer-and-retry on send failure (prescreen reminders, cadences) must treat
 * these as terminal — the 2026-09-07 incident was 817 Twilio rejections in
 * 36h from one cron re-sending to 19 invalid numbers every hour.
 */
export const PERMANENT_SMS_ERROR_CODES: ReadonlySet<string> = new Set([
  TWILIO_INVALID_TO,
  TWILIO_NOT_SMS_CAPABLE,
  TWILIO_UNSUBSCRIBED_RECIPIENT,
  '21617', // Twilio: recipient opted out (alt code)
  '30006', // landline or unreachable carrier
  'PHONE_INVALID', // HRX: users.phoneInvalid stamped by recordSmsInvalidNumber
  'SMS_BLOCKED', // HRX: users.smsBlockedSystem (STOP / carrier block)
  'OPTED_OUT', // HRX: users.smsOptIn === false
]);

export interface SmsSendOutcome {
  success: boolean;
  status?: string;
  errorCode?: string | null;
  error?: string;
}

/** True when a failed send should NOT be retried against the same number. */
export function isPermanentSmsFailure(r: SmsSendOutcome | null | undefined): boolean {
  if (!r || r.success) return false;
  if (r.status === 'skipped') return true; // opt-out / blocked / invalid — sender refused before Twilio
  const code = String(r.errorCode ?? '').trim();
  if (code && PERMANENT_SMS_ERROR_CODES.has(code)) return true;
  return /invalid phone number|not sms capable|opted out|marked invalid/i.test(String(r.error ?? ''));
}
/** Default Slack channel when app_config/ops_alerts has none: #dev. */
const DEFAULT_OPS_CHANNEL = 'C08U7U0FL03';

export interface SmsCarrierBlockInput {
  tenantId: string | null;
  userId: string | null;
  toPhone: string;
  errorCode: string;
  errorMessage?: string;
  messageTypeId?: string | null;
  /** Free-form origin ('twilio.ts' | 'TwilioSmsProvider' | …). */
  source: string;
}

function last4(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-4) || '????';
}

/** Resolve the user (and tenant) by phone when the caller only knows the number. */
async function resolveUserByPhone(phone: string): Promise<{ uid: string; tenantId: string | null; name: string } | null> {
  const e164 = phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
  const snap = await db.collection('users').where('phoneE164', '==', e164).limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0].data() as Record<string, unknown>;
  const tenantId =
    (typeof d.activeTenantId === 'string' && d.activeTenantId) ||
    (typeof d.tenantId === 'string' && d.tenantId) ||
    (d.tenantIds && typeof d.tenantIds === 'object' ? Object.keys(d.tenantIds as object)[0] : null) ||
    null;
  const name = `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim() || '(no name)';
  return { uid: snap.docs[0].id, tenantId, name };
}

/**
 * Record a carrier-level block. Idempotent per (user, day). Never throws.
 * Returns true when a NEW alert doc was created.
 */
export async function recordSmsCarrierBlock(input: SmsCarrierBlockInput): Promise<boolean> {
  try {
    let uid = input.userId;
    let tenantId = input.tenantId;
    let name = '';
    if (!uid || !tenantId) {
      const r = await resolveUserByPhone(input.toPhone);
      if (r) {
        uid = uid || r.uid;
        tenantId = tenantId || r.tenantId;
        name = r.name;
      }
    } else {
      const u = await db.collection('users').doc(uid).get();
      const d = (u.data() ?? {}) as Record<string, unknown>;
      name = `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim();
    }
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (uid) {
      // Stop HRX from hammering a dead number; the START/UNSTOP handler
      // clears smsBlockedSystem when the worker re-subscribes.
      await db
        .collection('users')
        .doc(uid)
        .set(
          {
            smsBlockedSystem: true,
            smsBlockedReason: `twilio_${input.errorCode}`,
            smsBlockedCarrierAt: now,
            smsBlockedCarrierLastMessageType: input.messageTypeId ?? null,
          },
          { merge: true },
        );
    }

    if (!tenantId) {
      logger.warn('[smsDeliveryAlerts] carrier block with no tenant — logged only', { toLast4: last4(input.toPhone), errorCode: input.errorCode });
      return false;
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `sms_${input.errorCode}__${uid ?? last4(input.toPhone)}__${day}`;
    const ref = db.collection('tenants').doc(tenantId).collection('ops_alerts').doc(key);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        tx.update(ref, { occurrences: admin.firestore.FieldValue.increment(1), lastAt: now });
        return false;
      }
      tx.set(ref, {
        kind: 'sms_carrier_block',
        status: 'pending',
        tenantId,
        userId: uid ?? null,
        workerName: name || null,
        phoneLast4: last4(input.toPhone),
        errorCode: input.errorCode,
        errorMessage: (input.errorMessage ?? '').slice(0, 200),
        messageTypeId: input.messageTypeId ?? null,
        source: input.source,
        occurrences: 1,
        firstAt: now,
        lastAt: now,
        createdAt: now,
      });
      return true;
    });
  } catch (err) {
    logger.warn('[smsDeliveryAlerts] recordSmsCarrierBlock failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Record a number Twilio says can never receive SMS (21211 / 21614).
 * Stamps `users.phoneInvalid` so every sender skips the number until a
 * recruiter fixes it, and raises one ops alert per (user, day). Never throws.
 */
export async function recordSmsInvalidNumber(input: SmsCarrierBlockInput): Promise<boolean> {
  try {
    let uid = input.userId;
    let tenantId = input.tenantId;
    let name = '';
    if (!uid || !tenantId) {
      const r = await resolveUserByPhone(input.toPhone);
      if (r) {
        uid = uid || r.uid;
        tenantId = tenantId || r.tenantId;
        name = r.name;
      }
    } else {
      const u = await db.collection('users').doc(uid).get();
      const d = (u.data() ?? {}) as Record<string, unknown>;
      name = `${String(d.firstName ?? '')} ${String(d.lastName ?? '')}`.trim();
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (uid) {
      await db
        .collection('users')
        .doc(uid)
        .set(
          {
            phoneInvalid: true,
            phoneInvalidReason: `twilio_${input.errorCode}`,
            phoneInvalidAt: now,
            phoneInvalidLastMessageType: input.messageTypeId ?? null,
          },
          { merge: true },
        );
    }
    if (!tenantId) {
      logger.warn('[smsDeliveryAlerts] invalid number with no tenant — logged only', { toLast4: last4(input.toPhone), errorCode: input.errorCode });
      return false;
    }
    const day = new Date().toISOString().slice(0, 10);
    const key = `sms_${input.errorCode}__${uid ?? last4(input.toPhone)}__${day}`;
    const ref = db.collection('tenants').doc(tenantId).collection('ops_alerts').doc(key);
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        tx.update(ref, { occurrences: admin.firestore.FieldValue.increment(1), lastAt: now });
        return false;
      }
      tx.set(ref, {
        kind: 'sms_invalid_number',
        status: 'pending',
        tenantId,
        userId: uid ?? null,
        workerName: name || null,
        phoneLast4: last4(input.toPhone),
        errorCode: input.errorCode,
        errorMessage: (input.errorMessage ?? '').slice(0, 200),
        messageTypeId: input.messageTypeId ?? null,
        source: input.source,
        occurrences: 1,
        firstAt: now,
        lastAt: now,
        createdAt: now,
      });
      return true;
    });
  } catch (err) {
    logger.warn('[smsDeliveryAlerts] recordSmsInvalidNumber failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function formatAlert(a: Record<string, unknown>): string {
  const who = a.workerName ? `${a.workerName} (…${a.phoneLast4})` : `…${a.phoneLast4}`;
  const kind = String(a.kind ?? '');
  if (kind === 'sms_carrier_block') {
    return (
      `:no_entry: *SMS blocked by Twilio* — ${who} is unsubscribed at the carrier (error ${a.errorCode}). ` +
      `Every text to them fails until *they* text START to the 888. Last attempt: ${a.messageTypeId ?? 'unknown message'}` +
      (Number(a.occurrences) > 1 ? ` · ${a.occurrences} attempts today` : '') +
      (a.userId ? `\nhttps://hrxone.com/users/${a.userId}` : '')
    );
  }
  if (kind === 'sms_invalid_number') {
    return (
      `:phone: *Invalid phone number on file* — ${who}: Twilio rejected it (error ${a.errorCode}), so texts to this worker cannot be delivered. ` +
      `HRX has stopped sending until a recruiter corrects the number on their profile. Last attempt: ${a.messageTypeId ?? 'unknown message'}` +
      (a.userId ? `\nhttps://hrxone.com/users/${a.userId}` : '')
    );
  }
  return `:warning: ops alert ${kind}: ${JSON.stringify(a).slice(0, 300)}`;
}

/**
 * Post pending ops alerts to Slack. Caller supplies the bot token (from its
 * own bound secret). Returns the number posted. Never throws.
 */
export async function drainOpsAlertsToSlack(botToken: string | null | undefined, limit = 20): Promise<number> {
  if (!botToken) return 0;
  try {
    const cfg = await db.doc('app_config/ops_alerts').get();
    const channel = String(cfg.get('slackChannelId') ?? '').trim() || DEFAULT_OPS_CHANNEL;
    const snap = await db.collectionGroup('ops_alerts').where('status', '==', 'pending').limit(limit).get();
    let posted = 0;
    for (const d of snap.docs) {
      const text = formatAlert(d.data() as Record<string, unknown>);
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ channel, text, unfurl_links: false }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string };
      if (body.ok) {
        await d.ref.update({ status: 'posted', postedAt: admin.firestore.FieldValue.serverTimestamp(), slackTs: body.ts ?? null, slackChannel: channel });
        posted += 1;
      } else {
        logger.warn('[smsDeliveryAlerts] slack post failed', { id: d.id, error: body.error });
        await d.ref.update({ lastPostError: body.error ?? 'unknown', lastPostAttemptAt: admin.firestore.FieldValue.serverTimestamp() });
        if (body.error === 'invalid_auth' || body.error === 'channel_not_found') break;
      }
    }
    return posted;
  } catch (err) {
    logger.warn('[smsDeliveryAlerts] drain failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}
