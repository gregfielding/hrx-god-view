/**
 * Plan B Phase 1 Trigger: enqueue welcome system SMS on user creation.
 *
 * Canonical user collection in practice is /users/{userId} (public apply + workforce tools write here).
 * This trigger is intentionally scoped to system/programmatic SMS only.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { enqueueSystemWelcomeSms } from './systemSms';

if (!admin.apps.length) {
  admin.initializeApp();
}

export const enqueueWelcomeSmsOnUserCreated = onDocumentCreated(
  {
    document: 'users/{userId}',
    region: 'us-central1',
  },
  async (event) => {
    const userId = event.params.userId as string;
    const data = event.data?.data() as any | undefined;

    if (!data) {
      logger.warn('enqueueWelcomeSmsOnUserCreated: missing user data', { userId });
      return;
    }

    try {
      const phoneE164 = (data?.phoneE164 || '').trim();
      if (!phoneE164) {
        logger.info('Skipping welcome SMS: phoneE164 missing', { userId });
        return;
      }

      // Prefer tenant-scoped context if present on user doc
      const tenantId =
        data?.tenantId ||
        data?.activeTenantId ||
        (data?.tenantIds && typeof data.tenantIds === 'object' ? Object.keys(data.tenantIds)[0] : null);

      if (!tenantId) {
        logger.info('Skipping welcome SMS: tenantId missing', { userId });
        return;
      }

      const result = await enqueueSystemWelcomeSms({
        tenantId,
        userId,
        phoneE164,
        userData: data,
      });

      if (result.skipped) {
        logger.info('Welcome SMS skipped', { userId, tenantId, reason: result.reason });
      } else if (result.ok) {
        logger.info('Welcome SMS enqueued', { userId, tenantId, requestId: result.requestId, threadId: result.threadId });
      } else {
        logger.warn('Welcome SMS enqueue failed', { userId, tenantId, reason: result.reason });
      }
    } catch (err: any) {
      logger.error('Error in enqueueWelcomeSmsOnUserCreated', {
        userId,
        error: err?.message || String(err),
      });
    }
  }
);

