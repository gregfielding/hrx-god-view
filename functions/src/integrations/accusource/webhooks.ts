import { createHash } from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getAccusourceConfig } from './config';
import type { BackgroundCheckEventDocument, HrxBackgroundCheckStatus } from './types';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

type WebhookStatusProjection = {
  hrxStatus?: HrxBackgroundCheckStatus;
  finalReportReady?: boolean;
  drugReportReady?: boolean;
  profileCompleted?: boolean;
  orderCompleted?: boolean;
  providerStatus: string;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (!value || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',');
  return `{${body}}`;
}

function extractEventType(payload: Record<string, unknown>): string {
  const data = toRecord(payload.data);
  const candidate = payload.eventType || payload.event || payload.type || data.eventType || data.event || data.type;
  return String(candidate || 'unknown').trim() || 'unknown';
}

function extractProviderProfileId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const profile = payload.providerProfileId || payload.profileId || payload.profile_id || payload.applicantId || data.providerProfileId || data.profileId || data.profile_id || data.applicantId;
  const value = String(profile || '').trim();
  return value || null;
}

function extractClientId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const clientId = payload.clientId || payload.client_id || payload.referenceId || data.clientId || data.client_id || data.referenceId;
  const value = String(clientId || '').trim();
  return value || null;
}

function extractProviderEventId(payload: Record<string, unknown>): string | null {
  const data = toRecord(payload.data);
  const eventId = payload.eventId || payload.id || payload.webhookId || payload.webhook_id || data.eventId || data.id || data.webhookId || data.webhook_id;
  const value = String(eventId || '').trim();
  return value || null;
}

function buildDeterministicEventId(payload: Record<string, unknown>): string {
  const eventType = extractEventType(payload);
  const providerProfileId = extractProviderProfileId(payload) || '';
  const clientId = extractClientId(payload) || '';
  const providerEventId = extractProviderEventId(payload) || '';
  const fingerprint = `${eventType}|${providerProfileId}|${clientId}|${providerEventId}|${stableStringify(payload)}`;
  return createHash('sha256').update(fingerprint).digest('hex');
}

function mapWebhookToStatusProjection(eventType: string, payload: Record<string, unknown>): WebhookStatusProjection {
  const event = eventType.toLowerCase();
  const data = toRecord(payload.data);
  const providerStatusRaw = payload.status || data.status || eventType;
  const providerStatus = String(providerStatusRaw || eventType || 'unknown');
  const status: WebhookStatusProjection = { providerStatus };

  if (event.includes('awaiting') || event.includes('applicant') || event.includes('invite')) {
    status.hrxStatus = 'awaiting_applicant';
  } else if (event.includes('submitted') || event.includes('created')) {
    status.hrxStatus = 'submitted';
  } else if (event.includes('in_progress') || event.includes('processing') || event.includes('review')) {
    status.hrxStatus = 'in_progress';
  } else if (event.includes('drug_report_ready')) {
    status.hrxStatus = 'drug_report_ready';
    status.drugReportReady = true;
  } else if (event.includes('final_report_ready') || event.includes('report_ready')) {
    status.hrxStatus = 'report_ready';
    status.finalReportReady = true;
  } else if (event.includes('completed') || event.includes('clear') || event.includes('closed')) {
    status.hrxStatus = 'completed';
    status.orderCompleted = true;
  } else if (event.includes('cancel') || event.includes('void')) {
    status.hrxStatus = 'canceled';
  } else if (event.includes('error') || event.includes('fail') || event.includes('reject')) {
    status.hrxStatus = 'error';
  }

  const profileCompleted = payload.profileCompleted ?? data.profileCompleted;
  if (typeof profileCompleted === 'boolean') {
    status.profileCompleted = profileCompleted;
  } else if (event.includes('profile_completed')) {
    status.profileCompleted = true;
  }

  return status;
}

async function findBackgroundCheckMatch(
  providerProfileId: string | null,
  clientId: string | null,
): Promise<admin.firestore.QueryDocumentSnapshot | null> {
  if (providerProfileId) {
    const byProfile = await db
      .collectionGroup('backgroundChecks')
      .where('providerProfileId', '==', providerProfileId)
      .limit(1)
      .get();
    if (!byProfile.empty) return byProfile.docs[0];
  }

  if (clientId) {
    const byProviderClientId = await db
      .collectionGroup('backgroundChecks')
      .where('providerClientId', '==', clientId)
      .limit(1)
      .get();
    if (!byProviderClientId.empty) return byProviderClientId.docs[0];

    const byClientId = await db
      .collectionGroup('backgroundChecks')
      .where('clientId', '==', clientId)
      .limit(1)
      .get();
    if (!byClientId.empty) return byClientId.docs[0];
  }

  return null;
}

async function processWebhookPayload(payloadInput: unknown): Promise<{ id: string; duplicate: boolean; matched: boolean }> {
  const payload = toRecord(payloadInput);
  const eventType = extractEventType(payload);
  const providerProfileId = extractProviderProfileId(payload);
  const clientId = extractClientId(payload);
  const eventId = buildDeterministicEventId(payload);

  const intakeRef = db.collection('integrations_accusource_webhook_events').doc(eventId);
  const intakeBase: BackgroundCheckEventDocument & Record<string, unknown> = {
    id: eventId,
    type: eventType,
    source: 'accusource_webhook',
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    processingStatus: 'received',
    providerProfileId,
    providerClientId: clientId,
    payload,
    processingError: null,
  };

  try {
    await intakeRef.create(intakeBase);
  } catch (error: any) {
    const code = error?.code;
    if (code === 6 || code === 'already-exists') {
      logger.info('[accusource:webhook] duplicate event skipped', { eventId, eventType, providerProfileId, clientId });
      return { id: eventId, duplicate: true, matched: false };
    }
    throw error;
  }

  const matchedBackgroundCheck = await findBackgroundCheckMatch(providerProfileId, clientId);
  if (!matchedBackgroundCheck) {
    await intakeRef.set({
      processingStatus: 'ignored',
      processingError: 'no_background_check_match',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.warn('[accusource:webhook] unmatched event', { eventId, eventType, providerProfileId, clientId });
    return { id: eventId, duplicate: false, matched: false };
  }

  const statusProjection = mapWebhookToStatusProjection(eventType, payload);
  const parentUpdate: Record<string, unknown> = {
    lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
    lastWebhookType: eventType,
    providerStatus: statusProjection.providerStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (statusProjection.hrxStatus) parentUpdate.hrxStatus = statusProjection.hrxStatus;
  if (statusProjection.finalReportReady !== undefined) parentUpdate.finalReportReady = statusProjection.finalReportReady;
  if (statusProjection.drugReportReady !== undefined) parentUpdate.drugReportReady = statusProjection.drugReportReady;
  if (statusProjection.profileCompleted !== undefined) parentUpdate.profileCompleted = statusProjection.profileCompleted;
  if (statusProjection.orderCompleted !== undefined) parentUpdate.orderCompleted = statusProjection.orderCompleted;
  if (providerProfileId) parentUpdate.providerProfileId = providerProfileId;
  if (clientId) parentUpdate.providerClientId = clientId;

  await matchedBackgroundCheck.ref.set(parentUpdate, { merge: true });
  await matchedBackgroundCheck.ref.collection('events').doc(eventId).set({
    ...intakeBase,
    processingStatus: 'processed',
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await intakeRef.set({
    processingStatus: 'processed',
    processingError: null,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    matchedBackgroundCheckPath: matchedBackgroundCheck.ref.path,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  logger.info('[accusource:webhook] processed', {
    eventId,
    eventType,
    providerProfileId,
    clientId,
    backgroundCheckPath: matchedBackgroundCheck.ref.path,
    hrxStatus: statusProjection.hrxStatus || null,
  });

  return { id: eventId, duplicate: false, matched: true };
}

/**
 * Phase 1 webhook intake endpoint.
 * Intended route shape: POST /api/integrations/accusource/webhooks
 */
export const apiIntegrationsAccusourceWebhooks = onRequest(
  {
    cors: true,
    invoker: 'public',
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }
    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const config = getAccusourceConfig();
    if (!config.enabled) {
      response.status(503).json({ error: 'AccuSource integration disabled' });
      return;
    }

    try {
      const payloads = Array.isArray(request.body) ? request.body : [request.body];
      const results: Array<{ id: string; duplicate: boolean; matched: boolean }> = [];

      for (const payload of payloads) {
        const result = await processWebhookPayload(payload);
        results.push(result);
      }

      response.status(200).json({
        ok: true,
        received: payloads.length,
        processed: results.filter((r) => !r.duplicate).length,
        duplicates: results.filter((r) => r.duplicate).length,
        matched: results.filter((r) => r.matched).length,
      });
    } catch (error: any) {
      logger.error('[accusource:webhook] fatal error', { error: error?.message || String(error) });
      response.status(200).json({ ok: false });
    }
  },
);

