/**
 * Plan B Phase 1 Trigger: enqueue welcome system SMS on user creation.
 *
 * Canonical user collection (per Plan B): /tenants/{tenantId}/users/{userId}.
 * 
 * Note: parts of the codebase still read users from /users/{userId}. To avoid missing
 * welcome messages during rollout, we also register a best-effort fallback trigger
 * on /users/{userId}. Dedupe is enforced via dedupeKey welcome:{tenantId}:{userId}.
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
    document: 'tenants/{tenantId}/users/{userId}',
    region: 'us-central1',
  },
  async (event) => {
    const userId = event.params.userId as string;
    const tenantId = event.params.tenantId as string;
    const data = event.data?.data() as any | undefined;

    if (!data) {
      logger.warn('enqueueWelcomeSmsOnUserCreated: missing user data', { tenantId, userId });
      return;
    }

    try {
      const phoneE164 = (data?.phoneE164 || '').trim();
      if (!phoneE164) {
        logger.info('Skipping welcome SMS: phoneE164 missing', { tenantId, userId });
        return;
      }

      if (!tenantId) {
        logger.info('Skipping welcome SMS: tenantId missing from path', { userId });
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
        tenantId,
        userId,
        error: err?.message || String(err),
      });
    }
  }
);

/**
 * Fallback trigger: Some flows still create users at /users/{userId}.
 * This keeps Plan B Phase 1 working even if tenant-scoped mirror writes lag.
 */
export const enqueueWelcomeSmsOnRootUserCreated = onDocumentCreated(
  {
    document: 'users/{userId}',
    region: 'us-central1',
  },
  async (event) => {
    const userId = event.params.userId as string;
    const data = event.data?.data() as any | undefined;

    if (!data) {
      logger.warn('enqueueWelcomeSmsOnRootUserCreated: missing user data', { userId });
      return;
    }

    try {
      const phoneE164 = (data?.phoneE164 || '').trim();
      if (!phoneE164) {
        logger.info('Skipping welcome SMS (root user trigger): phoneE164 missing', { userId });
        return;
      }

      // Best-effort tenant resolve from user doc
      const tenantId =
        data?.tenantId ||
        data?.activeTenantId ||
        (data?.tenantIds && typeof data.tenantIds === 'object' ? Object.keys(data.tenantIds)[0] : null);

      if (!tenantId) {
        logger.info('Skipping welcome SMS (root user trigger): tenantId missing', { userId });
        return;
      }

      const result = await enqueueSystemWelcomeSms({
        tenantId,
        userId,
        phoneE164,
        userData: data,
      });

      if (result.skipped) {
        logger.info('Welcome SMS skipped (root user trigger)', { userId, tenantId, reason: result.reason });
      } else if (result.ok) {
        logger.info('Welcome SMS enqueued (root user trigger)', {
          userId,
          tenantId,
          requestId: result.requestId,
          threadId: result.threadId,
        });
      } else {
        logger.warn('Welcome SMS enqueue failed (root user trigger)', { userId, tenantId, reason: result.reason });
      }
    } catch (err: any) {
      logger.error('Error in enqueueWelcomeSmsOnRootUserCreated', {
        userId,
        error: err?.message || String(err),
      });
    }
  }
);

