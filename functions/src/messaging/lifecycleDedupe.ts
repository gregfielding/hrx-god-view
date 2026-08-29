import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

/**
 * Idempotency guard for lifecycle-triggered notifications.
 *
 * Returns true when this is the first time we've seen the key.
 * Returns false for duplicate trigger executions/retries.
 */
export async function markLifecycleEventIfFirst(args: {
  tenantId: string;
  dedupeKey: string;
  eventType: string;
  context?: Record<string, unknown>;
}): Promise<boolean> {
  const { tenantId, dedupeKey, eventType, context = {} } = args;
  const ref = db.doc(`tenants/${tenantId}/notification_dedupe/${dedupeKey}`);

  try {
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;

      tx.set(ref, {
        dedupeKey,
        eventType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        context,
        version: 1,
      });
      return true;
    });

    if (!claimed) {
      logger.info('Lifecycle dedupe hit; skipping duplicate notification', {
        tenantId,
        dedupeKey,
        eventType,
      });
    }

    return claimed;
  } catch (error: any) {
    // Fail-open to avoid suppressing critical operational notifications.
    logger.warn('Lifecycle dedupe check failed; proceeding without dedupe', {
      tenantId,
      dedupeKey,
      eventType,
      error: error?.message || String(error),
    });
    return true;
  }
}

/**
 * Release a claimed dedupe key after a FAILED send so a retry can claim it
 * again. Without this, claiming on the first *attempt* made every retry a
 * "dedupe_skip_already_sent" success — a worker whose SMS bounced at Twilio
 * was recorded as reminded and received nothing (audit 2026-08-29, B9).
 * Best-effort: a failed release just means the retry is suppressed, which
 * is the old behavior, never a double-send.
 */
export async function releaseLifecycleEvent(args: {
  tenantId: string;
  dedupeKey: string;
}): Promise<void> {
  const { tenantId, dedupeKey } = args;
  try {
    await db.doc(`tenants/${tenantId}/notification_dedupe/${dedupeKey}`).delete();
  } catch (error: any) {
    logger.warn('Lifecycle dedupe release failed; retry will be suppressed', {
      tenantId,
      dedupeKey,
      error: error?.message || String(error),
    });
  }
}
