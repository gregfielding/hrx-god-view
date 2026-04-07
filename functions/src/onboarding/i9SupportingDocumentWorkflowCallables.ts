/**
 * I-9 supporting document workflow: admin request + staff review (centralized validation / audit).
 * Pre-upload rows use empty storagePath; uploads are worker Storage + Firestore updates (see rules).
 */
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { CALLABLE_BROWSER_CORS } from '../integrations/callableBrowserCors';
import { canManageOnboarding } from './workerOnboardingPipeline';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export type CreateWorkerI9SupportingDocumentRequestPayload = {
  tenantId: string;
  userId: string;
  documentType: string;
  requestedForEntityId?: string | null;
  requestedFromAssignmentId?: string | null;
};

export type ReviewWorkerI9SupportingDocumentPayload = {
  tenantId: string;
  documentId: string;
  decision: 'approved' | 'rejected';
  /** Required when decision === 'rejected'. */
  rejectionReason?: string | null;
};

export const createWorkerI9SupportingDocumentRequest = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '256MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const caller = request.auth.uid;
    const data = (request.data || {}) as CreateWorkerI9SupportingDocumentRequestPayload;
    const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const userId = typeof data.userId === 'string' ? data.userId.trim() : '';
    const documentType = typeof data.documentType === 'string' ? data.documentType.trim() : '';
    if (!tenantId || !userId || !documentType) {
      throw new HttpsError('invalid-argument', 'tenantId, userId, and documentType are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, caller))) {
      throw new HttpsError('permission-denied', 'Not authorized to create I-9 supporting document requests');
    }

    const col = db.collection(`tenants/${tenantId}/worker_i9_supporting_documents`);
    const docRef = col.doc();
    const now = admin.firestore.FieldValue.serverTimestamp();

    const requestedForEntityId =
      typeof data.requestedForEntityId === 'string' ? data.requestedForEntityId.trim() : '';
    const requestedFromAssignmentId =
      typeof data.requestedFromAssignmentId === 'string' ? data.requestedFromAssignmentId.trim() : '';

    await docRef.set({
      tenantId,
      userId,
      documentType,
      status: 'awaiting_upload',
      storagePath: '',
      uploadedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null,
      retainUntil: null,
      createdByUid: caller,
      createdAt: now,
      updatedAt: now,
      ...(requestedForEntityId ? { requestedForEntityId } : {}),
      ...(requestedFromAssignmentId ? { requestedFromAssignmentId } : {}),
    });

    logger.info('i9_supporting_document.request_created', {
      tenantId,
      documentId: docRef.id,
      targetUserId: userId,
      documentType,
      callerUid: caller,
    });

    return { documentId: docRef.id };
  },
);

export const reviewWorkerI9SupportingDocument = onCall(
  { enforceAppCheck: false, cors: CALLABLE_BROWSER_CORS, memory: '256MiB' },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    const caller = request.auth.uid;
    const data = (request.data || {}) as ReviewWorkerI9SupportingDocumentPayload;
    const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const documentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';
    const decision = data.decision;
    if (!tenantId || !documentId || (decision !== 'approved' && decision !== 'rejected')) {
      throw new HttpsError('invalid-argument', 'tenantId, documentId, and decision (approved|rejected) are required');
    }

    if (!(await canManageOnboarding(request.auth, tenantId, caller))) {
      throw new HttpsError('permission-denied', 'Not authorized to review I-9 supporting documents');
    }

    const reasonRaw = typeof data.rejectionReason === 'string' ? data.rejectionReason.trim() : '';
    if (decision === 'rejected' && !reasonRaw) {
      throw new HttpsError('invalid-argument', 'rejectionReason is required when decision is rejected');
    }

    const docRef = db.doc(`tenants/${tenantId}/worker_i9_supporting_documents/${documentId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Document not found');
    }
    const meta = snap.data() as Record<string, unknown>;
    if (String(meta.tenantId || '').trim() !== tenantId) {
      throw new HttpsError('failed-precondition', 'tenantId mismatch');
    }

    const storagePath = String(meta.storagePath || '').trim();
    if (decision === 'approved' && !storagePath) {
      throw new HttpsError('failed-precondition', 'Cannot approve without an uploaded file');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (decision === 'approved') {
      await docRef.update({
        status: 'approved',
        reviewedAt: now,
        reviewedBy: caller,
        rejectionReason: null,
        updatedAt: now,
      });
      logger.info('i9_supporting_document.review_approved', {
        tenantId,
        documentId,
        targetUserId: String(meta.userId || ''),
        callerUid: caller,
      });
    } else {
      await docRef.update({
        status: 'rejected',
        reviewedAt: now,
        reviewedBy: caller,
        rejectionReason: reasonRaw,
        updatedAt: now,
      });
      logger.info('i9_supporting_document.review_rejected', {
        tenantId,
        documentId,
        targetUserId: String(meta.userId || ''),
        callerUid: caller,
      });
    }

    return { ok: true as const, documentId, decision };
  },
);
