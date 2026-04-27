/**
 * Legacy: FCM on tenants/{tenantId}/applications/{applicationId} onCreate.
 *
 * Application "thank you" push + inbox are delivered by the messaging orchestrator
 * (sendLegacyApplicationStatusMessage → sendMessage) from applicationSmsTriggers.
 * This trigger intentionally does nothing to avoid duplicate FCM/inbox rows.
 *
 * Draft mirrors use status `in_progress`; final submit uses `submitted` and is handled
 * by onApplicationStatusChanged + orchestrator.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

export const onApplicationCreatedPush = onDocumentCreated(
  'tenants/{tenantId}/applications/{applicationId}',
  async (event) => {
    const { tenantId, applicationId } = event.params;
    const snap = event.data;
    if (!snap?.exists) return;

    const applicationData = snap.data() as Record<string, any>;
    const st = String(applicationData?.status || '').trim().toLowerCase();

    if (st !== 'submitted') {
      logger.info('[PUSH][application_created] skipped (delegated): status not submitted', {
        applicationId,
        tenantId,
        status: applicationData?.status,
      });
      return;
    }

    logger.info(
      '[PUSH][application_created] skipped (delegated to messaging orchestrator for application_received)',
      { applicationId, tenantId }
    );
  }
);
