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
  /** V2 create: SourceDirect profile number (e.g. PRO-…). */
  providerProfileNumber?: string | null;
  /** V2 create: SourceDirect subject id. */
  providerSubjectId?: string | number | null;
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
  /** Set after successful provider create / sync (server timestamp). */
  lastSyncAt?: Timestamp | null;
  lastWebhookAt?: Timestamp | null;
  /** Raw create response body (or normalized payload) for demo/debug. */
  lastProviderProfileSnapshot?: unknown;
  createdBy?: string | null;
  /** Assignment-confirmed automation (AccuSource or simulated). */
  automationSource?: string | null;
  automationAssignmentId?: string | null;
  /** Hiring entity Firestore id when ordered outside an assignment (on-call employment). */
  automationHiringEntityId?: string | null;
  /** C1 tab key for Employment V2 linkage when no `jobOrderId`. */
  relationshipEntityKey?: 'select' | 'workforce' | 'events' | string | null;
  automationTenantId?: string | null;
  automationFingerprint?: string | null;
  automationOrderedAt?: Timestamp | null;
  /** True when `ENABLE_SCREENING_ORDER` was false — no provider API call. */
  screeningOrderSimulated?: boolean;
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
