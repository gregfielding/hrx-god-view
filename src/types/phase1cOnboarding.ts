/**
 * Phase 1C — Documents + E-Sign Infrastructure
 * Firestore types for onboarding documents and signature envelopes.
 */

export type OnboardingDocumentMode = 'acknowledge' | 'upload' | 'esign';

export type OnboardingDocumentStatus = 'draft' | 'active' | 'archived';

export type OnboardingDocument = {
  docId: string;
  tenantId: string;
  docKey: string;
  title: string;
  version: string;
  status: OnboardingDocumentStatus;
  effectiveDate?: string;
  mode: OnboardingDocumentMode;
  appliesTo?: Array<'W2' | '1099' | 'BOTH'>;
  file: {
    storagePath: string;
    fileName: string;
    contentType: string;
    size: number;
    sha256?: string;
  };
  signatureTemplate?: {
    provider: 'docusign' | 'dropboxsign' | 'adobe' | 'other';
    templateId?: string;
  };
  createdAt: any; // Firestore Timestamp
  updatedAt: any; // Firestore Timestamp
};

export type SignatureProvider = 'none' | 'docusign' | 'dropboxsign' | 'adobe';

export type SignatureEnvelopeStatus =
  | 'not_sent'
  | 'queued'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'canceled'
  | 'failed';

export type SignatureEnvelope = {
  envelopeId: string;
  tenantId: string;
  userId: string;
  assignmentId?: string;
  jobOrderId?: string;
  entityId?: string;
  docKey: string;
  docVersion: string;
  onboardingDocumentId?: string;
  provider: SignatureProvider;
  providerEnvelopeId?: string;
  providerStatus?: string;
  signingUrl?: string;
  viewUrl?: string;
  downloadUrl?: string;
  status: SignatureEnvelopeStatus;
  statusReason?: string;
  createdBy?: { uid: string; name?: string } | null;
  createdAt: any;
  updatedAt: any;
  mergeFields?: Record<string, unknown>;
  fileSnapshot?: {
    storagePath: string;
    sha256?: string;
  };
};

export type SignatureEnvelopeEventType =
  | 'created'
  | 'queued'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'canceled'
  | 'failed'
  | 'provider_webhook';

export type SignatureEnvelopeEvent = {
  type: SignatureEnvelopeEventType;
  at: any; // Firestore Timestamp
  message?: string;
  data?: unknown;
};
