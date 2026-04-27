/**
 * Client-side shape for `backgroundChecks/{id}` (AccuSource).
 * @see functions/src/integrations/accusource/types.ts
 */
import type { Timestamp } from 'firebase/firestore';

/** Aggregate verdict shown on the verdict chip + SCREENING header aggregate. */
export type AccusourceLineVerdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | 'PENDING';

/** `null` = no manual override active — use autoVerdict. */
export type AccusourceManualVerdict = 'PASSED' | 'FAILED' | 'NEEDS_REVIEW' | null;

export type AccusourceAdjudicationHistoryKind =
  | 'auto_verdict_changed'
  | 'manual_override_set'
  | 'manual_override_cleared';

export interface AccusourceAdjudicationHistoryEntry {
  at?: Timestamp | null;
  kind: AccusourceAdjudicationHistoryKind;
  verdict: AccusourceManualVerdict | AccusourceLineVerdict;
  fromVerdict?: AccusourceManualVerdict | AccusourceLineVerdict | null;
  by: string;
  reason?: string | null;
  autoReason?: string | null;
}

export interface AccusourceLineAdjudication {
  autoVerdict: AccusourceLineVerdict;
  autoVerdictReason?: string | null;
  autoVerdictAt?: Timestamp | null;
  /** null = use autoVerdict (no manual override active). */
  verdict: AccusourceManualVerdict;
  overriddenBy?: string | null;
  overriddenAt?: Timestamp | null;
  overrideReason?: string | null;
  history?: AccusourceAdjudicationHistoryEntry[];
}

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
  /** From webhook: numeric price when vendor sends it. */
  providerPrice?: number | null;
  /** From webhook: display price string when vendor sends it. */
  providerPriceFormatted?: string | null;
  /** County / venue / search scope (e.g. “Orange, US-FL”). */
  jurisdiction?: string | null;
  /** AccuSource researcher / assignment label when present. */
  assignmentLabel?: string | null;
  orderedAt?: Timestamp | null;
  submittedAt?: Timestamp | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  receivedAt?: Timestamp | null;
  reviewedAt?: Timestamp | null;
  providerReportedAt?: Timestamp | null;
  /** Link to completed report (PDF/HTML) when the vendor webhook includes it. */
  reportUrl?: string | null;
  /** Adjudication / decision when AccuSource sends it. */
  decision?: string | null;
  decisionAt?: Timestamp | null;
  providerOrderId?: string | number | null;
  providerRegistrationId?: string | number | null;
  labName?: string | null;
  labCode?: number | null;
  labShortDescription?: string | null;
  labLongDescription?: string | null;
  /**
   * Per-line adjudication (auto verdict + optional recruiter override + history).
   * Populated server-side on every webhook merge; overrides set via
   * `setAccusourceLineAdjudication` callable.
   */
  adjudication?: AccusourceLineAdjudication | null;
}

export interface LastServiceComponent {
  serviceId?: string | null;
  serviceName?: string | null;
  status?: string | null;
  statusId?: string | number | null;
  updatedAt?: Timestamp | null;
  jurisdiction?: string | null;
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
  /** Optional alias for the same URL (some webhooks write `applicantPortalUrl`). */
  applicantPortalUrl?: string | null;
  /** Raw invite token from AccuSource `partial_profile_link` webhook when resent. */
  providerPartialProfileToken?: string | null;
  providerStatusId?: string | number | null;
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
  /** Service id strings sent on the order (matches catalog `services[].id`). */
  requestedServices?: string[];
  /** Snapshot of catalog rows at order time (id / name / type) for UI + readiness without re-querying catalog. */
  requestedServicesCatalog?: Array<{ id: string; name: string; type?: string }>;
  /** Latest per-service line item from `service_status_change` webhooks. */
  lastServiceComponent?: LastServiceComponent | null;
  /** Keyed by SourceDirect service id (string). */
  providerServiceOrderStatus?: Record<string, ServiceOrderStatusEntry> | null;
  /** Profile- or order-level report artifact URL (e.g. final_report_ready). */
  providerFinalReportUrl?: string | null;
  providerFinalReportAt?: Timestamp | null;
  providerFinalDecision?: string | null;
  providerFinalDecisionAt?: Timestamp | null;
  /**
   * **R.6** — `true` on synthetic records created via
   * `markAccusourceBackgroundCheckCompleteOutside` (the "Mark cleared via
   * prior check" flow). These docs are pre-completed (no provider API
   * call) so the readiness reconciler can short-circuit to
   * `complete_pass`. The original AccuSource order's history is left
   * intact — see `READINESS_R6_HANDOFF.md` D3.R6.
   */
  markedCompleteOutsideHrx?: boolean;
  markedCompleteOutsideHrxAt?: Timestamp | string | null;
  markedCompleteOutsideHrxBy?: string | null;
  markedCompleteOutsideHrxNotes?: string | null;
}

export interface BackgroundCheckEventRow {
  id: string;
  type?: string;
  processingStatus?: string;
  receivedAt?: Timestamp | null;
  processedAt?: Timestamp | null;
}
