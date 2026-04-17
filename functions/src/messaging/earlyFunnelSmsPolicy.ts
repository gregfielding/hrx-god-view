/**
 * Early-funnel SMS coordination: prevents overlapping "next step" SMS for the same user
 * (application thank-you, apply-wizard invite, prescreen invite, auto new-user invite).
 *
 * Uses `tenants/{tenantId}/notification_dedupe/early_funnel_sms__{userId}` — same family as lifecycle dedupe.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

/** Message types that participate in mutual cooldown (SMS). */
export const EARLY_FUNNEL_SMS_MESSAGE_TYPE_IDS = new Set([
  'application_received',
  'application_received_interview_next_step',
  'apply_wizard_interview_invite',
  'worker_ai_prescreen_invite',
  'worker_ai_prescreen_gap_interview_invite',
  'auto_new_user_interview_invite',
  'recent_user_backfill_interview_invite',
]);

/**
 * Minimum gap between any two early-funnel SMS to the same user (default 3 minutes).
 * Stops back-to-back stacks; does not block the ~15m prescreen reminder after apply.
 * Override with env `EARLY_FUNNEL_MIN_GAP_MS` (milliseconds).
 */
export function earlyFunnelMinGapMs(): number {
  const raw = String(process.env.EARLY_FUNNEL_MIN_GAP_MS || '').trim();
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 30_000 && n <= 3_600_000) return n;
  }
  return 3 * 60 * 1000;
}

export function isEarlyFunnelSmsMessageType(messageTypeId: string | undefined): boolean {
  return !!messageTypeId && EARLY_FUNNEL_SMS_MESSAGE_TYPE_IDS.has(messageTypeId);
}

export async function checkEarlyFunnelSmsGate(args: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
}): Promise<{ allowed: true } | { allowed: false; reason: string; lastMessageTypeId?: string; elapsedMs?: number }> {
  if (!isEarlyFunnelSmsMessageType(args.messageTypeId)) {
    return { allowed: true };
  }
  const tid = String(args.tenantId || '').trim();
  const uid = String(args.userId || '').trim();
  if (!tid || !uid || tid === 'system') {
    return { allowed: true };
  }

  const ref = db.doc(`tenants/${tid}/notification_dedupe/early_funnel_sms__${uid}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return { allowed: true };
  }
  const data = snap.data() || {};
  const lastSentAt = data.lastSentAt as admin.firestore.Timestamp | undefined;
  if (!lastSentAt || typeof lastSentAt.toMillis !== 'function') {
    return { allowed: true };
  }
  const elapsed = Date.now() - lastSentAt.toMillis();
  const gap = earlyFunnelMinGapMs();
  if (elapsed >= gap) {
    return { allowed: true };
  }
  const lastType = String(data.lastMessageTypeId || '');
  logger.info('early_funnel_sms.suppressed_cooldown', {
    tenantId: tid,
    userId: uid,
    messageTypeId: args.messageTypeId,
    lastMessageTypeId: lastType,
    elapsedMs: elapsed,
    minGapMs: gap,
  });
  return {
    allowed: false,
    reason: 'early_funnel_min_gap',
    lastMessageTypeId: lastType,
    elapsedMs: elapsed,
  };
}

/** Call after a successful outbound SMS for an early-funnel type. */
export async function recordEarlyFunnelSmsSent(args: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
}): Promise<void> {
  if (!isEarlyFunnelSmsMessageType(args.messageTypeId)) return;
  const tid = String(args.tenantId || '').trim();
  const uid = String(args.userId || '').trim();
  if (!tid || !uid || tid === 'system') return;

  const ref = db.doc(`tenants/${tid}/notification_dedupe/early_funnel_sms__${uid}`);
  await ref.set(
    {
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageTypeId: args.messageTypeId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
