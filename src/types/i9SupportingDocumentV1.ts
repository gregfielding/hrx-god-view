/**
 * I-9 supporting (identity / work authorization) uploads — tenant + user canonical scope.
 * @see docs/I9_SUPPORTING_DOCUMENTS_ARCHITECTURE.md
 */

/** Review lifecycle (v1). */
export type I9SupportingDocumentV1Status =
  | 'awaiting_upload'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | string;

/**
 * A. Canonical ownership + required review metadata (Firestore body must satisfy this).
 */
export interface I9SupportingDocumentV1Core {
  tenantId: string;
  userId: string;
  documentType: string;
  /**
   * Full GCS object path. Empty string before first worker upload (pre-upload rows from admin request).
   */
  storagePath: string;
  status: I9SupportingDocumentV1Status;
  /** Null until the worker uploads a file. */
  uploadedAt: unknown | null;
  reviewedAt: unknown | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  retainUntil: unknown | null;
}

/**
 * B. Optional workflow / traceability only — never required to load or reuse the document.
 */
export interface I9SupportingDocumentV1OptionalContext {
  requestedForEntityId?: string | null;
  requestedFromAssignmentId?: string | null;
  lastUsedForEntityId?: string | null;
  lastUsedAt?: unknown | null;
}

/**
 * C. Optional upload hints and audit (v1).
 */
export interface I9SupportingDocumentV1ExtendedFields {
  /** Staff uid who created the request (callable). */
  createdByUid?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  uploadedFileName?: string | null;
  uploadedContentType?: string | null;
}

export type I9SupportingDocumentV1 = I9SupportingDocumentV1Core &
  I9SupportingDocumentV1OptionalContext &
  I9SupportingDocumentV1ExtendedFields;
