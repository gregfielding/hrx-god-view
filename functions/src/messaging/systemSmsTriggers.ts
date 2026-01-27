/**
 * Plan B Phase 1 Trigger: enqueue welcome system SMS on user creation.
 *
 * Phase 1 canonical user collection: /users/{userId}.
 *
 * NOTE: Do not add tenant-scoped user triggers yet. We will introduce
 * `tenants/{tenantId}/users/{userId}` only after Phase 1 is validated end-to-end.
 * This trigger is intentionally scoped to system/programmatic SMS only.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { enqueueSystemWelcomeSms } from './systemSms';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

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

      // Best-effort tenant resolve from user doc
      const tenantId =
        data?.tenantId ||
        data?.activeTenantId ||
        (data?.tenantIds && typeof data.tenantIds === 'object' ? Object.keys(data.tenantIds)[0] : null);

      if (!tenantId) {
        logger.info('Skipping welcome SMS: tenantId missing', { userId });
        return;
      }

      // Tenant kill-switch: default OFF unless explicitly enabled.
      // Path: tenants/{tenantId}/settings/messaging { systemSmsEnabled: boolean }
      try {
        const settingsDoc = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('settings')
          .doc('messaging')
          .get();
        const systemSmsEnabled = settingsDoc.exists ? !!settingsDoc.data()?.systemSmsEnabled : false;
        if (!systemSmsEnabled) {
          logger.info('Skipping welcome SMS: tenant messaging.systemSmsEnabled is false', { tenantId, userId });
          return;
        }
      } catch (settingsErr: any) {
        // Fail closed: if we can't read settings, do not send.
        logger.warn('Skipping welcome SMS: failed to read tenant messaging settings (fail closed)', {
          tenantId,
          userId,
          error: settingsErr?.message,
        });
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
        tenantId: data?.tenantId || data?.activeTenantId,
        error: err?.message || String(err),
      });
    }
  }
);

