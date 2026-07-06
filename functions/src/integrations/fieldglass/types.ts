/**
 * **Fieldglass → HRX intake — server-side types (FG Slice 1+2).**
 *
 * Mirrors the Indeed Flex ingest architecture (`shared/indeedFlex/types.ts`)
 * but kept as a SEPARATE server-only module: the indeedFlex types file is
 * byte-mirrored across shared/ ↔ src/shared/ ↔ functions/src/shared/ for
 * client use, and widening its literal `provider` unions would mean touching
 * all three copies for no client benefit yet. Fieldglass docs live in the
 * SAME collections (`external_ingest_events`, `external_shift_requests`)
 * with `provider: 'fieldglass'` — the Indeed Flex triggers gate on their own
 * provider value, so the two pipelines coexist without collision. When the
 * review UI grows a Fieldglass renderer, promote what it needs to the
 * mirrored shared/ dir.
 *
 * Scope note (Greg, 2026-07-06): intake stops at the review queue + recruiter
 * alert. JO creation, worksite/child-account wiring, and auto-messaging
 * user-group config are deliberately NOT modeled yet.
 */

/** Doc shape for `external_ingest_events` rows with provider 'fieldglass'.
 *  Field-compatible with the Indeed Flex `ExternalIngestEvent` shape. */
export interface FieldglassIngestEvent {
  provider: 'fieldglass';
  eventHash: string;
  receivedAt: string;
  authVerification: {
    dkim: 'pass' | 'fail' | 'none' | 'unknown';
    dkimDomains: string[];
    spf: 'pass' | 'softfail' | 'fail' | 'none' | 'unknown';
    sender: string;
    senderDomain: string;
    senderIp?: string;
  };
  raw: {
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
    headers?: string;
    envelope?: string;
    attachmentCount?: number;
    truncated?: boolean;
  };
  status: 'received' | 'rejected_dkim' | 'parsed' | 'parse_failed';
  rejectionReason?: string;
  parsedRequestIds?: string[];
  parseFailureReason?: string;
}

/** The one event type this slice classifies. Closed/updated/withdrawn
 *  notifications land as `parse_failed: unclassified` for now (visible in
 *  the ingest audit trail) until their extractors are built. */
export type FieldglassEventType = 'new_job_posting';

/**
 * Fields extracted from a "New Job Posting submitted" notification email.
 * Everything optional except the posting id — emails vary (Comments To
 * Supplier can be entirely empty; see the Dishroom-Lead sample).
 */
export interface FieldglassNewJobPostingEvent {
  type: 'new_job_posting';
  /** e.g. "SDXOJP00186302" — the durable Fieldglass key. */
  jobPostingId: string;
  title?: string;
  description?: string;
  /** MM/DD/YYYY as printed in the email. */
  startDate?: string;
  endDate?: string;
  businessUnit?: string;
  /** Site NAME as printed — exact key into the Sodexo site directory
   *  (docs/reference/sodexo-site-list-*.csv). Resolution to an HRX
   *  account/worksite happens in a later slice. */
  siteName?: string;
  locationName?: string;
  /** Full free-text "Comments To Supplier" block (uniforms, screening,
   *  wage prose). Kept verbatim for the review UI + later LLM passes. */
  commentsToSupplier?: string;
  /** Hourly wage when stated in the comments (e.g. "$16.36 as the
   *  hourly wage"). */
  payRate?: number;
  /** payRate × 1.56 — the Sodexo rate-card markup (Greg, 2026-07-06).
   *  Derived, not extracted; absent when payRate is absent. */
  billRateDerived?: number;
  /** Deep link to job_posting_detail.do from the email body. */
  detailUrl?: string;
}

/** Doc shape for `external_shift_requests` rows with provider 'fieldglass'.
 *  Doc ID = `fieldglass__{jobPostingId}` — a re-distributed posting updates
 *  its existing row rather than duplicating. */
export interface FieldglassJobPostingRequest {
  id: string;
  tenantId: string;
  provider: 'fieldglass';
  sourceIngestEventHash: string;
  eventType: FieldglassEventType;
  event: FieldglassNewJobPostingEvent;
  /** high = id+title+site+dates all extracted; medium = id+title; low = id only. */
  confidence: 'high' | 'medium' | 'low';
  parseSource: 'regex';
  parseNotes?: string;
  status: 'needs_review' | 'approved' | 'applied' | 'rejected' | 'superseded';
  /** Set when the instant recruiter SMS alert was dispatched. */
  alertSentAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

/** Config doc at `tenants/{tid}/integrations/fieldglass`. */
export interface FieldglassIntegrationConfig {
  /** E.164 phones that get the instant new-order SMS. Empty/absent = no alerts. */
  alertPhonesE164?: string[];
  alertEnabled?: boolean;
}
