/**
 * HRX Signatures — webhook endpoint scaffold. Phase S0: verification stubbed.
 * POST /webhooks/signatures/dropboxsign (deploy as webhooksSignaturesDropboxsign or similar).
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

export const webhooksSignaturesDropboxsign = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const payload = req.body as Record<string, unknown> | null;
  const eventType = (payload?.event as string) ?? (payload?.data as Record<string, unknown>)?.event as string ?? 'unknown';
  const providerRequestId =
    (payload?.signature_request_id as string) ??
    (payload?.data as Record<string, unknown>)?.signature_request_id as string ??
    null;

  if (providerRequestId) {
    const group = db.collectionGroup('signature_envelopes');
    const snap = await group.where('providerRequestId', '==', providerRequestId).limit(1).get();
    if (!snap.empty) {
      const ref = snap.docs[0].ref;
      const status = mapEventToStatus(eventType);
      if (status) {
        await ref.update({
          status,
          providerStatus: eventType,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          'webhook.lastEventAt': admin.firestore.FieldValue.serverTimestamp(),
          'webhook.lastEventType': eventType,
        });
        await ref.collection('events').add({
          type: 'WEBHOOK_RECEIVED',
          at: admin.firestore.FieldValue.serverTimestamp(),
          actorType: 'provider',
          data: { eventType, providerRequestId },
        });
      }
    }
  }
  res.status(200).json({ received: true });
});

function mapEventToStatus(eventType: string): string | null {
  const e = (eventType || '').toLowerCase();
  if (e.includes('signed') || e.includes('complete')) return 'completed';
  if (e.includes('declined')) return 'declined';
  if (e.includes('viewed') || e.includes('open')) return 'viewed';
  if (e.includes('sent') || e.includes('deliver')) return 'sent';
  if (e.includes('void') || e.includes('cancel')) return 'voided';
  return null;
}
