/**
 * HRX Signatures — signing sessions: create session, get session, resolve signing URL.
 */

import * as admin from 'firebase-admin';
import { signaturePaths, getSignerPageUrl } from './signatureConfig';
import { stubProvider } from './providers';

const db = admin.firestore();

const SESSION_TTL_SEC = 3600;

export interface CreateSigningSessionInput {
  tenantId: string;
  envelopeId: string;
  signerId: string;
  returnUrl: string;
  userId?: string;
  contactId?: string;
}

export async function createSigningSession(input: CreateSigningSessionInput): Promise<{
  sessionId: string;
  signerPageUrl: string;
  expiresAt: string;
}> {
  const { tenantId, envelopeId, signerId, returnUrl, userId, contactId } = input;
  const sessionRef = db.collection(signaturePaths.signatureSessions(tenantId)).doc();
  const sessionId = sessionRef.id;
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await sessionRef.set({
    tenantId,
    envelopeId,
    signerId,
    returnUrl,
    userId: userId ?? null,
    contactId: contactId ?? null,
    provider: 'stub',
    status: 'created',
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    createdAt: now,
    updatedAt: now,
  });
  const signerPageUrl = getSignerPageUrl(sessionId);
  return { sessionId, signerPageUrl, expiresAt: expiresAt.toISOString() };
}

export async function getSession(tenantId: string, sessionId: string): Promise<{
  sessionId: string;
  envelopeId: string;
  signerId: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
  expired: boolean;
} | null> {
  const ref = db.doc(signaturePaths.signatureSession(tenantId, sessionId));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data() as { envelopeId: string; signerId: string; returnUrl: string; status: string; expiresAt: admin.firestore.Timestamp };
  const expiresAt = d.expiresAt?.toDate?.() ?? new Date(0);
  return {
    sessionId,
    envelopeId: d.envelopeId,
    signerId: d.signerId,
    returnUrl: d.returnUrl,
    status: d.status,
    expiresAt: expiresAt.toISOString(),
    expired: expiresAt.getTime() < Date.now(),
  };
}

/** Resolve session by ID only (signer page: tenantId comes from session doc). */
export async function getSessionBySessionId(sessionId: string): Promise<{
  tenantId: string;
  sessionId: string;
  envelopeId: string;
  signerId: string;
  returnUrl: string;
  status: string;
  expiresAt: string;
  expired: boolean;
} | null> {
  const group = db.collectionGroup('signature_sessions');
  const snap = await group.where(admin.firestore.FieldPath.documentId(), '==', sessionId).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data() as { tenantId: string; envelopeId: string; signerId: string; returnUrl: string; status: string; expiresAt: admin.firestore.Timestamp };
  const tenantId = data.tenantId;
  const out = await getSession(tenantId, sessionId);
  if (!out) return null;
  return { ...out, tenantId };
}

/** Get embedded signing URL for session (stub returns signer page URL). */
export async function getSigningUrl(tenantId: string, sessionId: string): Promise<{ url: string; expiresAt?: string }> {
  const provider = stubProvider;
  const result = await provider.getEmbeddedSigningUrl({
    tenantId,
    envelopeId: '',
    sessionId,
    signerId: '',
  });
  return {
    url: result.url,
    expiresAt: result.expiresAt?.toISOString(),
  };
}
