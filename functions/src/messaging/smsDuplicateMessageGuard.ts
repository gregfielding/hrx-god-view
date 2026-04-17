/**
 * Last-line SMS guard: same messageTypeId to same user within 60s → suppress.
 * Used by sendWorkerMessageInternal and by routingOrchestrator `deliverSMS` (same Firestore dedupe docs).
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();

const GUARD_MS = 60_000;

function safeDocSegment(s: string): string {
  return String(s || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 150);
}

export async function checkSmsDuplicateMessageTypeGuard(args: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
}): Promise<{ allowed: true } | { allowed: false; elapsedMs: number }> {
  const tid = String(args.tenantId || '').trim();
  const uid = String(args.userId || '').trim();
  const mid = String(args.messageTypeId || '').trim();
  if (!tid || !uid || tid === 'system' || !mid) {
    return { allowed: true };
  }

  const ref = db.doc(
    `tenants/${tid}/notification_dedupe/sms_dup_guard_60s__${uid}__${safeDocSegment(mid)}`,
  );
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
  if (elapsed >= GUARD_MS) {
    return { allowed: true };
  }
  return { allowed: false, elapsedMs: elapsed };
}

export async function recordSmsDuplicateMessageGuardSent(args: {
  tenantId: string;
  userId: string;
  messageTypeId: string;
}): Promise<void> {
  const tid = String(args.tenantId || '').trim();
  const uid = String(args.userId || '').trim();
  const mid = String(args.messageTypeId || '').trim();
  if (!tid || !uid || tid === 'system' || !mid) {
    return;
  }
  const ref = db.doc(
    `tenants/${tid}/notification_dedupe/sms_dup_guard_60s__${uid}__${safeDocSegment(mid)}`,
  );
  await ref.set(
    {
      lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageTypeId: mid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
