/**
 * HRX Signatures — callables: createEnvelope, createSigningSession, getSession, admin list/void.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createEnvelope, voidEnvelope } from './signatureService';
import { createSigningSession, getSession, getSessionBySessionId, getSigningUrl } from './signatureSessions';
import { signaturePaths } from './signatureConfig';

const db = admin.firestore();

function requireAuth(request: { auth?: { uid: string; token?: Record<string, unknown> } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be authenticated');
  return request.auth;
}

function canManageSignatures(auth: { token?: { roles?: Record<string, { role?: string }>; hrx?: boolean } } | null | undefined, tenantId: string): boolean {
  if (!auth?.token) return false;
  const roles = auth.token.roles ?? {};
  const role = roles[tenantId]?.role;
  if (role && ['Recruiter', 'Manager', 'Admin'].includes(String(role))) return true;
  if (auth.token.hrx === true) return true;
  return false;
}

export const signatureCreateEnvelope = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const entityId = typeof d?.entityId === 'string' ? d.entityId : '';
  if (!tenantId || !entityId) throw new HttpsError('invalid-argument', 'tenantId and entityId required');
  if (!canManageSignatures(request.auth as any, tenantId)) throw new HttpsError('permission-denied', 'Not allowed');

  const envelopeId = typeof d?.envelopeId === 'string' ? d.envelopeId : db.collection('_').doc().id;
  const purpose = typeof d?.purpose === 'string' ? d.purpose : 'other';
  const documents = Array.isArray(d?.documents) ? d.documents as { docTemplateId: string; version: number; name: string; pdfRef: string; pdfSha256?: string }[] : [];
  const signers = Array.isArray(d?.signers) ? d.signers as { signerId: string; role: string; name: string; email: string; userId?: string; order: number }[] : [];
  const bundleId = typeof d?.bundleId === 'string' ? d.bundleId : undefined;
  const blocking = d?.blocking === true;
  const subject = (d?.subject as Record<string, unknown>) ?? {};

  return createEnvelope({
    tenantId,
    entityId,
    envelopeId,
    purpose,
    documents,
    signers,
    bundleId,
    blocking,
    subject,
  });
});

export const signatureCreateSigningSession = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const envelopeId = typeof d?.envelopeId === 'string' ? d.envelopeId : '';
  const signerId = typeof d?.signerId === 'string' ? d.signerId : '';
  const returnUrl = typeof d?.returnUrl === 'string' ? d.returnUrl : '';
  if (!tenantId || !envelopeId || !signerId || !returnUrl) {
    throw new HttpsError('invalid-argument', 'tenantId, envelopeId, signerId, returnUrl required');
  }
  if (!canManageSignatures(request.auth as any, tenantId)) throw new HttpsError('permission-denied', 'Not allowed');
  const userId = typeof d?.userId === 'string' ? d.userId : request.auth?.uid;
  const contactId = typeof d?.contactId === 'string' ? d.contactId : undefined;
  return createSigningSession({ tenantId, envelopeId, signerId, returnUrl, userId, contactId });
});

/** For signer page: pass sessionId only; returns session info (safe). */
export const signatureGetSession = onCall(async (request) => {
  const d = request.data as Record<string, unknown> | null;
  const sessionId = typeof d?.sessionId === 'string' ? d.sessionId : '';
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required');
  const session = await getSessionBySessionId(sessionId);
  if (!session) throw new HttpsError('not-found', 'Session not found');
  return session;
});

/** Returns embedded signing URL for the session (signer page calls this). */
export const signatureGetSigningUrl = onCall(async (request) => {
  const d = request.data as Record<string, unknown> | null;
  const sessionId = typeof d?.sessionId === 'string' ? d.sessionId : '';
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required');
  const session = await getSessionBySessionId(sessionId);
  if (!session) throw new HttpsError('not-found', 'Session not found');
  if (session.expired) throw new HttpsError('failed-precondition', 'Session expired');
  return getSigningUrl(session.tenantId, sessionId);
});

export const signatureAdminListEnvelopes = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  if (!tenantId) throw new HttpsError('invalid-argument', 'tenantId required');
  if (!canManageSignatures(request.auth as any, tenantId)) throw new HttpsError('permission-denied', 'Not allowed');
  const limit = Math.min(Math.max(0, Number(d?.limit) || 50), 100);
  const snap = await db.collection(signaturePaths.signatureEnvelopes(tenantId)).orderBy('createdAt', 'desc').limit(limit).get();
  const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return { envelopes: list };
});

export const signatureAdminVoidEnvelope = onCall(async (request) => {
  requireAuth(request);
  const d = request.data as Record<string, unknown> | null;
  const tenantId = typeof d?.tenantId === 'string' ? d.tenantId : '';
  const envelopeId = typeof d?.envelopeId === 'string' ? d.envelopeId : '';
  if (!tenantId || !envelopeId) throw new HttpsError('invalid-argument', 'tenantId, envelopeId required');
  if (!canManageSignatures(request.auth as any, tenantId)) throw new HttpsError('permission-denied', 'Not allowed');
  await voidEnvelope(tenantId, envelopeId);
  return { ok: true };
});
