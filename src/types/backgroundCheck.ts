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
  /** PASSED (default) or FAILED when a CSA marked the package complete outside HRX. */
  markedCompleteOutsideHrxVerdict?: 'PASSED' | 'FAILED';
  markedCompleteOutsideHrxAt?: Timestamp | string | null;
  markedCompleteOutsideHrxBy?: string | null;
  markedCompleteOutsideHrxNotes?: string | null;
  /**
   * **R.10** — `true` once the daily expiry sweep
   * (`runBackgroundCheckExpiryPass`) has flipped this check past its
   * resolved validity threshold. The sweep filters
   * `WHERE expired != true` so checks are stamped at most once.
   * Manual flips back to `false` are not part of automation — only ordering
   * a new check unblocks the worker. See `docs/READINESS_R10_HANDOFF.md`.
   */
  expired?: boolean;
  /** **R.10** — Server timestamp when the sweep stamped `expired: true`. */
  expiredAt?: Timestamp | null;
  /**
   * **R.10** — Validity threshold (in days) actually applied at expiry
   * time. Resolved from the JO → Location → Account cascade by
   * `mergeScreeningValidityDaysFromLayers` at sweep time. Stamped for
   * audit clarity ("what threshold was used here?") without coupling
   * check-time and policy-time data.
   */
  expiredValidityDays?: number;
  /**
   * **R.11** — Detected package drift. Stamped by
   * `onJobOrderWriteDetectScreeningPackageDrift` when the JO's
   * `screeningPackageId` changes while this check is in-flight, AND the
   * new package is not a strict subset of this check's `requestedServices`
   * (i.e. drift is `'more_strict'` or `'incomparable'`). Cleared via
   * `acknowledgeBackgroundCheckPackageDriftCallable`.
   *
   * **L1.R11** — Authoritative drift state lives only on this doc; not
   * mirrored to readiness items. Drift is informational, not a status
   * change. See `docs/READINESS_R11_HANDOFF.md`.
   */
  packageDrift?: BackgroundCheckPackageDrift;
  /**
   * **R.11** — Denormalized boolean for the R.8 matrix banner's
   * tenant-wide drift count query. Set in lockstep with `packageDrift`;
   * cleared on acknowledgment. Indexed via
   * `(tenantId, hasPendingPackageDrift)` composite (see
   * `firestore.indexes.json`).
   */
  hasPendingPackageDrift?: boolean;
}

/**
 * **R.11** — Package drift state. The check was ordered with
 * `requestedPackageId` X, but the underlying JO's `screeningPackageId`
 * subsequently changed to `expectedPackageId`, and the service-set
 * comparison classified the new package as `'more_strict'` or
 * `'incomparable'`.
 *
 * Once `acknowledgedAt` is set, the drift is considered resolved (CSA
 * accepted that the older package is sufficient); the banner / drawer
 * surfaces hide it. The full struct is preserved for audit even after
 * acknowledgment.
 *
 * @see docs/READINESS_R11_HANDOFF.md
 */
export interface BackgroundCheckPackageDrift {
  /** JO whose screening-package change triggered the drift detection. */
  jobOrderId: string;
  /** When the trigger first stamped this drift. */
  detectedAt: Timestamp;
  /** New package id from the JO at detection time. May be null if the JO transitioned to "no package". */
  expectedPackageId: string | null;
  /** New package display name from the JO at detection time. */
  expectedPackageName: string | null;
  /**
   * Snapshot of the new package's `serviceIds` from the AccuSource
   * catalog at detection time. Stored for audit so future readers can
   * reconstruct the drift decision without re-reading a possibly-mutated
   * catalog. Null when the catalog was unreadable / package missing
   * (`driftKind: 'incomparable'` path).
   */
  expectedServiceIds?: string[] | null;
  /**
   * Decision class:
   *   - `'more_strict'`: new package adds at least one service the existing
   *     check doesn't cover. Real drift; CSA must decide.
   *   - `'incomparable'`: service-set comparison was not possible (legacy
   *     check missing `requestedServices`, or catalog miss on new package).
   *     Stamped conservatively per L3.R11 — fail-safe in the visible
   *     direction.
   *
   * `'less_strict'` is short-circuited at detection time and never
   * persisted (the check already covers everything the new package wants;
   * no operator action needed).
   */
  driftKind: 'more_strict' | 'incomparable';
  /** Set when CSA acknowledges via `acknowledgeBackgroundCheckPackageDriftCallable`. */
  acknowledgedAt?: Timestamp | null;
  /** UID of the CSA who acknowledged. */
  acknowledgedBy?: string | null;
  /** Optional CSA note explaining the acknowledgment ("older package was fine because X"). */
  acknowledgmentNote?: string | null;
}

export interface BackgroundCheckEventRow {
  id: string;
  type?: string;
  processingStatus?: string;
  receivedAt?: Timestamp | null;
  processedAt?: Timestamp | null;
}
