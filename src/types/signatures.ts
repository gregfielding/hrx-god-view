/**
 * HRX Signatures — provider-agnostic e-sign types (HRX Signatures Spec).
 * Document templates, bundles, envelopes, events, signing sessions.
 */

export type DocumentTemplateCategory =
  | 'employment'
  | 'handbook'
  | 'wc_ack'
  | 'client_contract'
  | 'policy'
  | 'other';

export type WorkerTypeFilter = 'w2' | '1099' | 'both';

export interface DocumentTemplateAppliesTo {
  workerType?: WorkerTypeFilter;
  entityIds?: string[];
  jobOrderTypes?: string[];
}

export interface DocumentTemplate {
  id: string;
  tenantId: string;
  entityId?: string | null;
  createdBy?: string;
  name: string;
  category: DocumentTemplateCategory;
  appliesTo?: DocumentTemplateAppliesTo;
  version: number;
  effectiveAt?: string;
  retiredAt?: string | null;
  supersedesDocTemplateId?: string | null;
  pdfRef: string;
  pdfSha256?: string;
  pdfFileName?: string;
  providerHints?: Record<string, unknown>;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BundleItemSigner {
  role: 'worker' | 'client' | 'internal';
  order: number;
  requiresEmail: boolean;
}

export interface DocumentBundleItem {
  docTemplateId: string;
  titleOverride?: string;
  required: boolean;
  signers: BundleItemSigner[];
  blocking: boolean;
}

export interface DocumentBundle {
  id: string;
  tenantId: string;
  entityId?: string | null;
  name: string;
  description?: string;
  active: boolean;
  appliesTo?: DocumentTemplateAppliesTo;
  items: DocumentBundleItem[];
  createdAt?: string;
  updatedAt?: string;
}

export type EnvelopePurpose = 'worker_onboarding' | 'client_contract' | 'policy_update' | 'other';
export type SignatureProviderName = 'dropbox_sign' | 'docusign' | 'stub';
export type EnvelopeStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'error';

export interface EnvelopeDocument {
  docTemplateId: string;
  version: number;
  name: string;
  pdfRef: string;
  pdfSha256?: string;
}

export interface EnvelopeSigner {
  signerId: string;
  role: string;
  name: string;
  email: string;
  userId?: string | null;
  contactId?: string | null;
  order: number;
  status: string;
  signedAt?: string | null;
}

export interface SignatureEnvelope {
  id: string;
  tenantId: string;
  entityId: string;
  purpose: EnvelopePurpose;
  userId?: string | null;
  userEmploymentId?: string | null;
  assignmentId?: string | null;
  jobOrderId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  locationId?: string | null;
  provider: SignatureProviderName;
  providerRequestId?: string | null;
  providerEnv: 'stage' | 'prod';
  providerStatus?: string | null;
  status: EnvelopeStatus;
  statusDisplay?: string | null;
  documents: EnvelopeDocument[];
  signers: EnvelopeSigner[];
  bundleId?: string | null;
  blocking: boolean;
  onboardingInstanceId?: string | null;
  resolvedFrom?: Record<string, unknown>;
  files?: {
    signedPdfRef?: string | null;
    auditRef?: string | null;
    providerFiles?: string[];
  };
  webhook?: {
    lastEventAt?: string | null;
    lastEventType?: string | null;
    deliveryCount?: number;
  };
  requestHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
  sentAt?: string | null;
  completedAt?: string | null;
  voidedAt?: string | null;
  declinedAt?: string | null;
}

export type EnvelopeEventType =
  | 'CREATED'
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'VOIDED'
  | 'ERROR'
  | 'WEBHOOK_RECEIVED'
  | 'FILES_DOWNLOADED';

export interface SignatureEnvelopeEvent {
  id: string;
  type: EnvelopeEventType;
  at: string;
  actorType: 'system' | 'user' | 'admin' | 'provider';
  actorId?: string | null;
  data?: Record<string, unknown>;
}

export type SigningSessionStatus = 'created' | 'opened' | 'completed' | 'expired' | 'error';

export interface SigningSession {
  id: string;
  tenantId: string;
  envelopeId: string;
  signerId: string;
  userId?: string | null;
  contactId?: string | null;
  provider: SignatureProviderName;
  providerSigningUrl?: string | null;
  returnUrl: string;
  expiresAt: string;
  status: SigningSessionStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SignatureEnvelopePublic {
  envelopeId: string;
  tenantId: string;
  userId?: string | null;
  public: {
    status: string;
    statusDisplay?: string;
    signedPdfDownloadUrl?: string;
  };
  updatedAt?: string;
}
