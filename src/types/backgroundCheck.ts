/**
 * Client-side shape for `backgroundChecks/{id}` (AccuSource).
 * @see functions/src/integrations/accusource/types.ts
 */
import type { Timestamp } from 'firebase/firestore';

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

export interface ServiceOrderStatusEntry {
  serviceId?: unknown;
  serviceName?: string | null;
  status?: string | null;
  statusId?: string | number | null;
  updatedAt?: Timestamp | null;
}

export interface LastServiceComponent {
  serviceId?: string | null;
  serviceName?: string | null;
  status?: string | null;
  statusId?: string | number | null;
  updatedAt?: Timestamp | null;
}

export interface BackgroundCheckRecord {
  id: string;
  provider?: 'accusource';
  providerEnvironment?: 'sandbox' | 'production';
  tenantId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  candidateId?: string | null;
  candidateName?: string | null;
  applicantId?: string | null;
  jobOrderId?: string | null;
  worksiteId?: string | null;
  clientId?: string;
  providerProfileId?: string | null;
  providerClientId?: string | null;
  orderMode?: 'partial_profile' | 'full_profile';
  hrxStatus?: HrxBackgroundCheckStatus;
  providerStatus?: string | null;
  finalReportReady?: boolean;
  drugReportReady?: boolean;
  profileCompleted?: boolean;
  orderCompleted?: boolean;
  requestedPackageId?: string | number | null;
  requestedPackageName?: string | null;
  applicantPortalLink?: string | null;
  lastWebhookType?: string | null;
  syncError?: string | null;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastWebhookAt?: Timestamp | null;
  createdBy?: string | null;
  /** Latest per-service line item from `service_status_change` webhooks. */
  lastServiceComponent?: LastServiceComponent | null;
  /** Keyed by SourceDirect service id (string). */
  providerServiceOrderStatus?: Record<string, ServiceOrderStatusEntry> | null;
}

export interface BackgroundCheckEventRow {
  id: string;
  type?: string;
  processingStatus?: string;
  receivedAt?: Timestamp | null;
  processedAt?: Timestamp | null;
}
