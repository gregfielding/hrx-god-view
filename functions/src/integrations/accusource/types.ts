import type * as admin from 'firebase-admin';

export type AccusourceEnvironment = 'sandbox' | 'production';

export type HrxBackgroundCheckStatus =
  | 'draft'
  | 'queued'
  | 'submitted'
  | 'awaiting_applicant'
  | 'in_progress'
  | 'report_ready'
  | 'drug_report_ready'
  | 'completed'
  | 'canceled'
  | 'error';

export interface AccusourceProviderConfig {
  environment: AccusourceEnvironment;
  baseUrl: string;
  apiKey?: string;
  webhookSecret?: string;
  enabled: boolean;
}

export interface BackgroundCheckDocument {
  provider: 'accusource';
  providerEnvironment: AccusourceEnvironment;
  tenantId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  candidateId?: string | null;
  candidateName?: string | null;
  applicantId?: string | null;
  jobOrderId?: string | null;
  worksiteId?: string | null;
  clientId: string;
  providerProfileId?: string | null;
  /** Raw token from `partial_profile_link` webhook payload (for support / replay). */
  providerPartialProfileToken?: string | null;
  /** V2 create response: e.g. PRO-… */
  providerProfileNumber?: string | null;
  /** V2 create response: SourceDirect subject id */
  providerSubjectId?: string | number | null;
  providerClientId?: string | null;
  providerOrderIds?: string[] | null;
  orderMode: 'partial_profile' | 'full_profile';
  requestedPackageId?: string | number | null;
  requestedPackageName?: string | null;
  requestedServices?: string[];
  /** Catalog snapshot at order time (matches client / Firestore catalog `services[]`). */
  requestedServicesCatalog?: Array<{ id: string; name: string; type?: string }>;
  hrxStatus: HrxBackgroundCheckStatus;
  /** Applicant self-service URL (create response or `partial_profile_link` webhook). */
  applicantPortalLink?: string | null;
  /** Same URL as `applicantPortalLink` when written by webhooks (vendor-aligned name). */
  applicantPortalUrl?: string | null;
  providerStatus?: string | null;
  providerStatusId?: string | number | null;
  finalReportReady: boolean;
  drugReportReady: boolean;
  profileCompleted: boolean;
  orderCompleted: boolean;
  lastWebhookAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  lastWebhookType?: string | null;
  lastSyncAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  syncError?: string | null;
  updatedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  /** Latest component from `service_status_change` webhooks. */
  lastServiceComponent?: {
    serviceId?: string | null;
    serviceName?: string | null;
    status?: string | null;
    statusId?: string | number | null;
    updatedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  } | null;
  /** Keyed by SourceDirect service id (string); merged on each `service_status_change`. */
  providerServiceOrderStatus?: Record<
    string,
    {
      serviceId?: unknown;
      serviceName?: string | null;
      status?: string | null;
      statusId?: string | number | null;
      updatedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
    }
  > | null;
}

export interface BackgroundCheckEventDocument {
  id: string;
  type: string;
  receivedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  processedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  source: 'accusource_webhook' | 'accusource_poll' | 'manual_sync';
  providerProfileId?: string | null;
  providerClientId?: string | null;
  payload: Record<string, unknown>;
  processingStatus: 'received' | 'processed' | 'ignored' | 'error';
  processingError?: string | null;
}

