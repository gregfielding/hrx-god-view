/**
 * Callable: issue short-lived signed URLs for I-9 supporting document objects.
 * Staff do not use broad Storage read rules; Firestore metadata is authorization SoT.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { getStorageBucketName } from '../utils/storageBucket';
import { canManageOnboarding } from './workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export interface GetI9SupportingDocumentSignedUrlPayload {
  tenantId: string;
  documentId: string;
}

function expectedPathPrefix(tenantId: string, userId: string): string {
  return `i9_docs/${tenantId}/${userId}/`;
}

export const getI9SupportingDocumentSignedUrl = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '256MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const data = (request.data || {}) as GetI9SupportingDocumentSignedUrlPayload;
    const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const documentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';
    if (!tenantId || !documentId) {
      throw new HttpsError('invalid-argument', 'tenantId and documentId are required');
    }

    const docRef = db.doc(`tenants/${tenantId}/worker_i9_supporting_documents/${documentId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Document metadata not found');
    }

    const meta = snap.data() as Record<string, unknown>;
    const userId = String(meta.userId || '').trim();
    const metaTenantId = String(meta.tenantId || '').trim();
    const storagePath = String(meta.storagePath || '').trim();

    if (!userId || metaTenantId !== tenantId) {
      throw new HttpsError('failed-precondition', 'Invalid metadata');
    }
    if (!storagePath) {
      throw new HttpsError('failed-precondition', 'No file uploaded yet');
    }
    if (!storagePath.startsWith(expectedPathPrefix(tenantId, userId))) {
      throw new HttpsError('failed-precondition', 'storagePath does not match canonical layout');
    }

    const caller = request.auth.uid;
    const isOwner = caller === userId;
    const isStaff = await canManageOnboarding(request.auth, tenantId, caller);
    if (!isOwner && !isStaff) {
      throw new HttpsError('permission-denied', 'Not authorized for this file');
    }

    const bucket = getStorage().bucket(getStorageBucketName());
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'Object not found in storage');
    }

    const expires = Date.now() + SIGNED_URL_TTL_MS;
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires,
      version: 'v4',
    });

    return {
      url,
      expiresAt: expires,
      storagePath,
    };
  }
);
