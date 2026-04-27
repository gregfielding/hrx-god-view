/**
 * Phase 1C — Signatures API
 * signaturesStartEnvelope callable + webhook receiver scaffold
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import { startEnvelope } from './signatureService';

const db = admin.firestore();

/**
 * Start a signature envelope.
 * Callable by future triggers (assignment created, recruiter action, etc.)
 */
export const signaturesStartEnvelope = onCall(
  {
    enforceAppCheck: false,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    const { tenantId, envelopeId, userId, assignmentId, docKey, docVersion, onboardingDocumentId } =
      request.data || {};

    if (!tenantId || !envelopeId || !userId || !docKey || !docVersion || !onboardingDocumentId) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required: tenantId, envelopeId, userId, docKey, docVersion, onboardingDocumentId'
      );
    }

    const result = await startEnvelope({
      tenantId,
      envelopeId,
      userId,
      assignmentId,
      docKey,
      docVersion,
      onboardingDocumentId,
    });

    return result;
  }
);

/** Map provider event type to our status */
function mapProviderEventToStatus(provider: string, eventType: string): string | null {
  const normalized = (eventType || '').toLowerCase();
  if (normalized.includes('signed') || normalized.includes('complete')) return 'signed';
  if (normalized.includes('declined') || normalized.includes('reject')) return 'declined';
  if (normalized.includes('viewed') || normalized.includes('open')) return 'viewed';
  if (normalized.includes('sent') || normalized.includes('deliver')) return 'sent';
  if (normalized.includes('expired')) return 'expired';
  if (normalized.includes('cancel')) return 'canceled';
  return null;
}

/**
 * Webhook receiver scaffold.
 * Provider POSTs events; we log, update envelope status, append to events subcollection.
 */
export const signaturesWebhookReceiver = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const payload = req.body;
  const provider = (req.query.provider as string) || 'unknown';

  console.log(`[signaturesWebhook] provider=${provider}`, JSON.stringify(payload).slice(0, 500));

  const providerEnvelopeId =
    payload?.data?.envelopeId ?? payload?.envelope_id ?? payload?.envelopeId ?? null;
  const eventType =
    payload?.event ?? payload?.event_type ?? payload?.status ?? payload?.data?.event ?? '';

  const status = mapProviderEventToStatus(provider, eventType);

  if (providerEnvelopeId && status) {
    // Look up envelope by providerEnvelopeId (query across tenants in Phase 2)
    const tenantsSnap = await db.collectionGroup('signature_envelopes').get();
    const match = tenantsSnap.docs.find(
      (d) => (d.data() as { providerEnvelopeId?: string })?.providerEnvelopeId === providerEnvelopeId
    );
    if (match) {
      const ref = match.ref;
      await ref.update({
        status,
        providerStatus: eventType,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await ref.collection('events').add({
        type: eventType,
        at: admin.firestore.FieldValue.serverTimestamp(),
        message: `Webhook: ${eventType}`,
        rawPayload: payload,
      });
    }
  }

  res.status(200).json({ received: true });
});
