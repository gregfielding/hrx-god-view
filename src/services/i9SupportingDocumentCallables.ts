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

export type EnsureWorkerI9SlotsForMyEmploymentRecordInput = {
  tenantId: string;
  employmentRecordId: string;
};

export type EnsureWorkerI9SlotsForMyEmploymentRecordResult = {
  ok: true;
  skipped: boolean;
  reason: string | null;
  documentIds: string[] | null;
};

export function callEnsureWorkerI9SlotsForMyEmploymentRecord(
  functions: Functions,
  payload: EnsureWorkerI9SlotsForMyEmploymentRecordInput,
) {
  return httpsCallable<
    EnsureWorkerI9SlotsForMyEmploymentRecordInput,
    EnsureWorkerI9SlotsForMyEmploymentRecordResult
  >(functions, 'ensureWorkerI9SlotsForMyEmploymentRecord')(payload);
}

export type SetEntityEmploymentI9SupportingManualCompleteInput = {
  tenantId: string;
  employmentId: string;
  complete: boolean;
};

export type SetEntityEmploymentI9SupportingManualCompleteResult = {
  success: boolean;
};

export function callSetEntityEmploymentI9SupportingManualComplete(
  functions: Functions,
  payload: SetEntityEmploymentI9SupportingManualCompleteInput,
) {
  return httpsCallable<
    SetEntityEmploymentI9SupportingManualCompleteInput,
    SetEntityEmploymentI9SupportingManualCompleteResult
  >(functions, 'setEntityEmploymentI9SupportingManualComplete')(payload);
}
