/**
 * HRX Signatures — orchestration: create envelope, append events, use provider.
 * Phase S0: stub provider only.
 */

import * as admin from 'firebase-admin';
import { signaturePaths } from './signatureConfig';
import { stubProvider } from './providers';
import type { CreateEnvelopeRequest, CreateEnvelopeResult } from './providers/types';
import type { SignatureProviderName } from './signatureSchemas';

const db = admin.firestore();

function getProvider(): typeof stubProvider {
  return stubProvider;
}

export interface CreateEnvelopeInput extends CreateEnvelopeRequest {
  envelopeId: string;
}

/** Create HRX envelope + provider request (stub creates draft only). */
export async function createEnvelope(input: CreateEnvelopeInput): Promise<{
  envelopeId: string;
  status: string;
  providerRequestId?: string;
}> {
  const { tenantId, entityId, envelopeId, purpose, documents, signers, bundleId, blocking, subject } = input;
  const provider = getProvider();
  const result = await provider.createEnvelope({
    tenantId,
    entityId,
    purpose,
    documents,
    signers,
    bundleId,
    blocking,
    subject,
  });

  const ref = db.doc(signaturePaths.signatureEnvelope(tenantId, envelopeId));
  const snap = await ref.get();
  if (snap.exists) {
    return { envelopeId, status: (snap.data() as { status?: string })?.status ?? result.status, providerRequestId: result.providerRequestId };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.set({
    tenantId,
    entityId,
    purpose: purpose || 'other',
    userId: subject?.userId ?? null,
    userEmploymentId: subject?.userEmploymentId ?? null,
    assignmentId: subject?.assignmentId ?? null,
    jobOrderId: subject?.jobOrderId ?? null,
    companyId: subject?.companyId ?? null,
    contactId: subject?.contactId ?? null,
    locationId: subject?.locationId ?? null,
    provider: 'stub' as SignatureProviderName,
    providerRequestId: result.providerRequestId ?? null,
    providerEnv: 'stage',
    providerStatus: result.status,
    status: result.status || 'draft',
    documents,
    signers: signers.map((s) => ({ ...s, status: 'pending', signedAt: null })),
    bundleId: bundleId ?? null,
    blocking: !!blocking,
    resolvedFrom: subject ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await ref.collection('events').add({
    type: 'CREATED',
    at: now,
    actorType: 'system',
    data: { provider: 'stub' },
  });

  return { envelopeId, status: result.status || 'draft', providerRequestId: result.providerRequestId };
}

/** Void envelope: call provider cancel + update Firestore. */
export async function voidEnvelope(tenantId: string, envelopeId: string): Promise<void> {
  const ref = db.doc(signaturePaths.signatureEnvelope(tenantId, envelopeId));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Envelope not found');
  const data = snap.data() as { providerRequestId?: string; status?: string };
  const provider = getProvider();
  await provider.cancelEnvelope({ tenantId, envelopeId, providerRequestId: data.providerRequestId });
  const now = admin.firestore.FieldValue.serverTimestamp();
  await ref.update({
    status: 'voided',
    voidedAt: now,
    updatedAt: now,
  });
  await ref.collection('events').add({
    type: 'VOIDED',
    at: now,
    actorType: 'system',
    data: {},
  });
}
