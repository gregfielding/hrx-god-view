/**
 * Callable: issue short-lived read URLs for I-9 supporting document objects.
 * Staff do not use broad Storage read rules; Firestore metadata is authorization SoT.
 *
 * Uses Firebase download-token URLs (see ../utils/firebaseStorageDownloadReadUrl.ts), not GCS V4
 * signed URLs, so the Cloud Functions SA does not need iam.serviceAccounts.signBlob.
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { getOrCreateFirebaseDownloadReadUrl } from '../utils/firebaseStorageDownloadReadUrl';
import { canManageOnboarding } from './workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
/** Client hint for cache / refresh; token URLs remain valid until metadata changes. */
const URL_HINT_TTL_MS = 15 * 60 * 1000;

export interface GetI9SupportingDocumentSignedUrlPayload {
  tenantId: string;
  documentId: string;
}

function expectedPathPrefix(tenantId: string, userId: string): string {
  return `i9_docs/${tenantId}/${userId}/`;
}

export const getI9SupportingDocumentSignedUrl = onCall(
  /** 512MiB: cold starts + Admin + importing `workerOnboardingPipeline` can exceed 256MiB (seen ~270MiB OOM). */
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '512MiB' },
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

    let url: string;
    try {
      url = await getOrCreateFirebaseDownloadReadUrl(storagePath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('does not exist')) {
        throw new HttpsError('not-found', 'Object not found in storage');
      }
      throw new HttpsError('internal', `Could not build read URL: ${msg}`);
    }

    const expires = Date.now() + URL_HINT_TTL_MS;

    return {
      url,
      expiresAt: expires,
      storagePath,
    };
  }
);
