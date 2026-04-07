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

/** Google Document AI — server-written only; assistive for review (not approval). */
export type I9DocumentExtractionStatus =
  | 'extraction_pending'
  | 'extraction_complete'
  | 'extraction_failed'
  | 'extraction_unsupported';

export interface I9DocumentExtractionBlock {
  status: I9DocumentExtractionStatus;
  requestedAt?: unknown | null;
  completedAt?: unknown | null;
  error?: { code?: string; message?: string; detail?: string } | null;
  processorType?:
    | 'us_driver_license'
    | 'us_passport'
    | 'custom_dl'
    | 'custom_ssn_card'
    | 'custom_green_card'
    | 'custom_ead'
    | 'custom_passport'
    | 'custom_state_id'
    | 'custom_birth_certificate'
    | null;
  processorResourceName?: string | null;
  sourceStoragePath?: string | null;
  extractedFields?: {
    documentCategory?: 'passport' | 'driver_license' | 'other';
    documentNumber?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    dateOfBirth?: string | null;
    expirationDate?: string | null;
    issueDate?: string | null;
    issuingState?: string | null;
    issuingCountry?: string | null;
    mrzCode?: string | null;
    extractedDocumentTypeLabel?: string | null;
    extractionWarnings?: string[];
  } | null;
  extractedRawEntities?: Array<{ type?: string; mentionText?: string; confidence?: number }>;
  extractionWarnings?: string[];
  confidenceSummary?: { overall?: number; byField?: Record<string, number> };
  documentAiProcessorVersion?: string | null;
  updatedAt?: unknown;
}

/** Recruiter-confirmed corrections on top of assistive extraction (optional; never required to approve). */
export interface I9DocumentReviewVerifiedFields {
  fullName?: string | null;
  documentNumber?: string | null;
  dateOfBirth?: string | null;
  expirationDate?: string | null;
  issueDate?: string | null;
  issuingState?: string | null;
  issuingCountry?: string | null;
}

export interface I9DocumentReviewBlock {
  verifiedFields?: I9DocumentReviewVerifiedFields;
  reviewedExtractionAt?: unknown | null;
  reviewedExtractionBy?: string | null;
}

export type I9SupportingDocumentV1 = I9SupportingDocumentV1Core &
  I9SupportingDocumentV1OptionalContext &
  I9SupportingDocumentV1ExtendedFields & {
    documentExtraction?: I9DocumentExtractionBlock;
    documentReview?: I9DocumentReviewBlock;
  };
