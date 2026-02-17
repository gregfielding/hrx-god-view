/**
 * Phase 1C — Signature Service
 * Callable by future triggers; creates envelope records, optionally sends via provider.
 */

import * as admin from 'firebase-admin';
import type { SignatureProvider, StartEnvelopeInput, StartEnvelopeResult } from './signatureProviders';
import { noneProvider } from './signatureProviders';

const db = admin.firestore();

const PROVIDERS: Record<SignatureProvider, typeof noneProvider> = {
  none: noneProvider,
  docusign: noneProvider, // placeholder
  dropboxsign: noneProvider, // placeholder
  adobe: noneProvider, // placeholder
};

/**
 * Get configured provider for tenant (Phase 1C: always "none")
 */
function getProvider(_tenantId: string): SignatureProvider {
  return 'none';
}

/**
 * Start a signature envelope.
 * Creates Firestore record; if provider configured, sends to provider.
 */
export async function startEnvelope(input: StartEnvelopeInput): Promise<StartEnvelopeResult> {
  const { tenantId, envelopeId, userId, docKey, docVersion, onboardingDocumentId } = input;
  const provider = getProvider(tenantId);
  const providerImpl = PROVIDERS[provider];

  const result = await providerImpl.sendEnvelope(input);

  const envelopeRef = db.doc(`tenants/${tenantId}/signature_envelopes/${envelopeId}`);
  const envelopeSnap = await envelopeRef.get();
  if (envelopeSnap.exists) {
    // Idempotent: already created
    return result;
  }

  await envelopeRef.set({
    envelopeId,
    tenantId,
    userId,
    assignmentId: input.assignmentId || null,
    jobOrderId: input.jobOrderId || null,
    entityId: input.entityId || null,
    docKey,
    docVersion,
    onboardingDocumentId,
    provider,
    providerEnvelopeId: result.providerEnvelopeId || null,
    providerStatus: result.providerEnvelopeId ? 'sent' : null,
    signingUrl: result.signingUrl || null,
    status: result.status,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Append created event
  await envelopeRef.collection('events').add({
    type: 'created',
    at: admin.firestore.FieldValue.serverTimestamp(),
    message: `Envelope created (provider=${provider})`,
  });

  return result;
}
