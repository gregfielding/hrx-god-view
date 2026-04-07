/**
 * Browser callables for I-9 supporting document workflow (admin/staff).
 * @see functions/src/onboarding/i9SupportingDocumentWorkflowCallables.ts
 */
import { httpsCallable, type Functions } from 'firebase/functions';

export type CreateWorkerI9SupportingDocumentRequestInput = {
  tenantId: string;
  userId: string;
  documentType: string;
  requestedForEntityId?: string | null;
  requestedFromAssignmentId?: string | null;
};

export type CreateWorkerI9SupportingDocumentRequestResult = {
  documentId: string;
};

export type ReviewWorkerI9SupportingDocumentInput = {
  tenantId: string;
  documentId: string;
  decision: 'approved' | 'rejected';
  rejectionReason?: string | null;
};

export type ReviewWorkerI9SupportingDocumentResult = {
  ok: true;
  documentId: string;
  decision: 'approved' | 'rejected';
};

export function callCreateWorkerI9SupportingDocumentRequest(
  functions: Functions,
  payload: CreateWorkerI9SupportingDocumentRequestInput,
) {
  return httpsCallable<CreateWorkerI9SupportingDocumentRequestInput, CreateWorkerI9SupportingDocumentRequestResult>(
    functions,
    'createWorkerI9SupportingDocumentRequest',
  )(payload);
}

export function callReviewWorkerI9SupportingDocument(
  functions: Functions,
  payload: ReviewWorkerI9SupportingDocumentInput,
) {
  return httpsCallable<ReviewWorkerI9SupportingDocumentInput, ReviewWorkerI9SupportingDocumentResult>(
    functions,
    'reviewWorkerI9SupportingDocument',
  )(payload);
}

export type GetI9SupportingDocumentSignedUrlInput = {
  tenantId: string;
  documentId: string;
};

export type GetI9SupportingDocumentSignedUrlResult = {
  url: string;
  expiresAt: number;
  storagePath: string;
};

export function callGetI9SupportingDocumentSignedUrl(
  functions: Functions,
  payload: GetI9SupportingDocumentSignedUrlInput,
) {
  return httpsCallable<GetI9SupportingDocumentSignedUrlInput, GetI9SupportingDocumentSignedUrlResult>(
    functions,
    'getI9SupportingDocumentSignedUrl',
  )(payload);
}
