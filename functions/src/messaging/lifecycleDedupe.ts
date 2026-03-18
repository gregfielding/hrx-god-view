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
