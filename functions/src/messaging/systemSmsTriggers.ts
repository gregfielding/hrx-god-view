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
import { enqueueSystemWelcomeSms, ensureSystemOnboardingWelcomeTemplates } from './systemSms';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import { SYSTEM_TRIGGER_KEYS } from './triggerRegistry';
import { TWILIO_MESSAGING_PHONE_NUMBER } from './twilioSecrets';
import { userIsInActiveMigration, MIGRATION_SUPPRESSION_LOG_TAG } from './migrationSuppress';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const enqueueWelcomeSmsOnUserCreated = onDocumentCreated(
  {
    document: 'users/{userId}',
    region: 'us-central1',
    // Needed so `systemSms.ts` can read the configured "from" number for threading.
    secrets: [TWILIO_MESSAGING_PHONE_NUMBER],
  },
  async (event) => {
    const userId = event.params.userId as string;
    const data = event.data?.data() as any | undefined;

    if (!data) {
      logger.warn('enqueueWelcomeSmsOnUserCreated: missing user data', { userId });
      return;
    }

    try {
      // Re-fetch user doc so we have latest firstName/lastName (often set in a follow-up write after create)
      let userData = data;
      try {
        const freshSnap = await db.doc(`users/${userId}`).get();
        if (freshSnap.exists && freshSnap.data()) {
          userData = freshSnap.data();
        }
      } catch (refetchErr: any) {
        logger.warn('enqueueWelcomeSmsOnUserCreated: could not re-fetch user, using snapshot', {
          userId,
          error: refetchErr?.message,
        });
      }

      // Bulk-migration suppression gate (BI.0 / BI.1) — defense-in-depth.
      // The function is already gated by `tenants/{t}/settings/messaging.systemSmsEnabled`
      // (default off), but the migration prefix gate is the architectural
      // contract: when a user doc carries `migrationSource: 'tempworks_*' | 'bi1_*'`,
      // refuse all auto-messaging regardless of tenant settings. The migration
      // tool owns its own messaging cadence. Run against the freshly-refetched
      // userData so we catch the case where `migrationSource` was written
      // by a follow-up `set({ ..., migrationSource }, { merge: true })` call.
      if (userIsInActiveMigration(userData as Record<string, unknown> | null | undefined)) {
        logger.info(`enqueueWelcomeSmsOnUserCreated: suppressed (${MIGRATION_SUPPRESSION_LOG_TAG})`, {
          userId,
          migrationSource: String((userData as Record<string, unknown>)?.migrationSource || ''),
        });
        return;
      }

      const phoneE164 = (userData?.phoneE164 || '').trim();
      if (!phoneE164) {
        logger.info('Skipping welcome SMS: phoneE164 missing', { userId });
        return;
      }

      // Best-effort tenant resolve from user doc
      const tenantId =
        userData?.tenantId ||
        userData?.activeTenantId ||
        (userData?.tenantIds && typeof userData.tenantIds === 'object'
          ? Object.keys(userData.tenantIds)[0]
          : null);

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
        const systemSmsEnabled = settingsDoc.exists
          ? !!settingsDoc.data()?.systemSmsEnabled
          : false;
        if (!systemSmsEnabled) {
          logger.info('Skipping welcome SMS: tenant messaging.systemSmsEnabled is false', {
            tenantId,
            userId,
          });
          return;
        }
      } catch (settingsErr: any) {
        // Fail closed: if we can't read settings, do not send.
        logger.warn(
          'Skipping welcome SMS: failed to read tenant messaging settings (fail closed)',
          {
            tenantId,
            userId,
            error: settingsErr?.message,
          },
        );
        return;
      }

      // New path: rule-based automation trigger for account creation.
      // Keep legacy enqueue as fallback while rule rollout is in progress.
      try {
        await ensureSystemOnboardingWelcomeTemplates(tenantId);
      } catch (templateSeedErr: any) {
        logger.warn('Failed to seed default onboarding templates before account-created dispatch', {
          userId,
          tenantId,
          error: templateSeedErr?.message,
        });
      }

      let dispatched = false;
      try {
        const dispatchResult = await dispatchSystemMessage({
          tenantId,
          triggerKey: SYSTEM_TRIGGER_KEYS.accountCreated,
          userId,
          context: {
            userData,
          },
          source: 'system',
          sourceId: userId,
        });
        dispatched = !!dispatchResult.sent;
        logger.info('Account-created automation dispatch attempted', {
          userId,
          tenantId,
          handled: dispatchResult.handled,
          sent: dispatchResult.sent,
          ruleIds: dispatchResult.ruleIds,
          errors: dispatchResult.errors,
        });
      } catch (dispatchErr: any) {
        logger.warn(
          'Account-created automation dispatch failed; falling back to legacy welcome SMS',
          {
            userId,
            tenantId,
            error: dispatchErr?.message,
          },
        );
      }

      if (dispatched) {
        logger.info(
          'Account-created message sent via automation rule(s); skipping legacy welcome fallback',
          {
            userId,
            tenantId,
          },
        );
        return;
      }

      const result = await enqueueSystemWelcomeSms({
        tenantId,
        userId,
        phoneE164,
        userData,
      });

      if (result.skipped) {
        logger.info('Welcome SMS skipped', { userId, tenantId, reason: result.reason });
      } else if (result.ok) {
        logger.info('Welcome SMS enqueued', {
          userId,
          tenantId,
          requestId: result.requestId,
          threadId: result.threadId,
        });
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
  },
);
