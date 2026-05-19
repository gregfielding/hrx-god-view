/**
 * Indeed Flex inbound-email ingestion — shared types.
 *
 * Mirrored to `src/shared/indeedFlex/types.ts` for the CRA bundle.
 * They MUST stay in sync byte-for-byte.
 *
 * Runtime-neutral: no firebase imports, no Timestamp. Dates are ISO-8601
 * strings. Callers convert to Firestore Timestamp on write.
 *
 * Slice 0 of the Indeed Flex email ingestion build. Subsequent slices wire
 * the SendGrid Inbound Parse webhook, the LLM extractor + needs-review
 * inbox, the approval callable, the worker-name alias layer, and the
 * update/cancel/no-show flows.
 */

/**
 * The kinds of events we parse out of inbound Indeed Flex emails. One
 * inbound email can produce multiple events (notably `daily_digest_expired`,
 * which lists many JOs in one digest), so the extractor returns an array.
 *
 * - `new_request`           — "New job request starting soon" email. Has a
 *                             Job ID in the body (e.g. `ID: 509668`).
 * - `change_headcount`      — booking-change email that adjusts the
 *                             number of workers required on an existing
 *                             shift. No Job ID in body; matched by
 *                             venue + role + date + time window.
 * - `change_time`           — booking-change email that moves the start/
 *                             end times on an existing shift. Usually
 *                             references `Job <id>`.
 * - `cancel_booking`        — "have removed the following bookings"
 *                             email. No Job ID; always routes to
 *                             human approval, never auto-cancels.
 * - `no_show`               — "Your assigned worker <name> did not turn
 *                             up to their shift" email. Maps to an
 *                             assignment-outcome update + recruiter
 *                             follow-up task.
 * - `daily_digest_expired`  — "Daily Brief: Allocations & Priorities →
 *                             Job requests expired" digest. Reconciled
 *                             against `external_shift_requests` to
 *                             surface drift; does not directly modify
 *                             shifts.
 */
export type IndeedFlexEventType =
  | 'new_request'
  | 'change_headcount'
  | 'change_time'
  | 'cancel_booking'
  | 'no_show'
  | 'daily_digest_expired';

/**
 * Constant used everywhere the ingestion path stamps `source`. Single
 * literal so a future "API-based ingest" (if Indeed Flex ships a partner
 * API) can add a sibling value without breaking matching.
 */
export const INDEED_FLEX_SOURCE = 'email_ingest' as const;
export type IndeedFlexSource = typeof INDEED_FLEX_SOURCE;

/**
 * Provenance marker stamped on a shift doc when the ingestion path
 * creates or updates it from an Indeed Flex inbound email. Distinguishes
 * ingested shifts from manually-created ones for audit / reporting.
 *
 * The Indeed Flex **Job ID** itself is NOT stored here — it lives in the
 * shift's `poNumber` field per existing project convention (one source
 * of truth, historical data already there, simple `where('poNumber', '==',
 * jobId)` lookups). Some Indeed emails (cancel + change_headcount) ship
 * without a Job ID today; Indeed acknowledges this and plans to fix it
 * upstream. Until then, callers fall back to venue + role + date + time
 * matching when no `poNumber` is available.
 */
export interface IndeedFlexExternalRef {
  source: IndeedFlexSource;
  /**
   * ISO-8601 timestamp of when the ingestion path wrote this ref.
   * Callers convert to / from Firestore Timestamp at the IO boundary.
   */
  importedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Inbound-email staging (Slice 1)
// ─────────────────────────────────────────────────────────────────────

/**
 * Processing state of a row in `tenants/{tid}/external_ingest_events`.
 *
 * Slice 1 (the inbound webhook) writes the first three statuses only.
 * Slice 2 (the parser worker) flips `received` rows to `parsed` or
 * `parse_failed` after extracting `IndeedFlexEvent[]` from the raw
 * payload.
 *
 * - `received`             — webhook accepted the email and persisted
 *                            it. Awaiting parse.
 * - `rejected_dkim`        — webhook persisted the raw payload but
 *                            won't process it further because DKIM
 *                            verification failed against the expected
 *                            sender domain. Kept on disk for audit.
 * - `rejected_duplicate`   — never written; idempotency hit. Listed
 *                            here for documentation completeness.
 * - `parsed`               — Slice 2 extracted events successfully.
 * - `parse_failed`         — Slice 2 ran but extraction errored out.
 *                            Raw payload stays for retry / debug.
 */
export type ExternalIngestEventStatus =
  | 'received'
  | 'rejected_dkim'
  | 'rejected_duplicate'
  | 'parsed'
  | 'parse_failed';

/**
 * Result of DKIM / SPF verification performed at the webhook edge.
 * Captured into Firestore alongside the raw payload so a spoofing
 * attempt is auditable after the fact.
 */
export interface ExternalIngestEventAuthVerification {
  /** DKIM result aggregated across all signatures on the message. */
  dkim: 'pass' | 'fail' | 'none' | 'unknown';
  /** Domains that signed the message (lowercased). */
  dkimDomains: string[];
  /** SPF result for the SMTP envelope sender. */
  spf: 'pass' | 'softfail' | 'fail' | 'none' | 'unknown';
  /** Raw RFC5322 From header value, e.g. `"Indeed Flex <x@y.com>"`. */
  sender: string;
  /** Lowercased domain extracted from the From header. */
  senderDomain: string;
  /** Source IP per SendGrid's `sender_ip` field, if present. */
  senderIp?: string;
}

/**
 * The trimmed-and-truncated raw payload we persist for each inbound
 * email. Body fields (`text`, `html`) are capped to keep the Firestore
 * doc under the 1MB limit — Indeed Flex notification emails are tiny
 * in practice (~1KB), so this cap is defensive.
 */
export interface ExternalIngestEventRaw {
  /** RFC5322 From header. */
  from: string;
  /** RFC5322 To header. */
  to: string;
  /** Subject line. */
  subject: string;
  /** Plain-text body. Capped to 256KB. */
  text?: string;
  /** HTML body. Capped to 256KB. */
  html?: string;
  /** Raw headers blob (line-joined). Capped to 64KB. */
  headers?: string;
  /** SendGrid's `envelope` JSON string. */
  envelope?: string;
  /** Count of file attachments (their content is not persisted in
   *  Slice 1; attachments are not in scope for Indeed Flex parsing). */
  attachmentCount?: number;
  /** True when any body field had to be truncated to fit. */
  truncated?: boolean;
}

/**
 * One inbound email's row in `tenants/{tid}/external_ingest_events`.
 *
 * Doc ID == `eventHash` (sha256, see `computeEventHash`). Slice 1
 * persists `provider: 'indeed_flex'` rows; future providers (Fieldglass,
 * Indeed Flex partner API if it ships, etc.) get sibling provider
 * values.
 */
export interface ExternalIngestEvent {
  /** Provider identifier. Slice 1 always writes `'indeed_flex'`. */
  provider: 'indeed_flex';
  /** sha256 of stable email content; used as Firestore doc ID. */
  eventHash: string;
  /**
   * ISO-8601 timestamp of when the webhook received the email.
   * Callers convert to / from Firestore Timestamp at the IO boundary.
   */
  receivedAt: string;
  authVerification: ExternalIngestEventAuthVerification;
  raw: ExternalIngestEventRaw;
  status: ExternalIngestEventStatus;
  /** Set when `status` starts with `rejected_`. Free-form code. */
  rejectionReason?: string;
  /**
   * Slice 2: when parsing succeeds, this lists the
   * `external_shift_requests` doc ids that this email produced. Empty
   * array when the email parsed but produced zero events (e.g. an
   * empty digest). Absent when status is still `received` /
   * `rejected_*`.
   */
  parsedRequestIds?: string[];
  /** Slice 2: free-form code surfaced when status is `parse_failed`. */
  parseFailureReason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Parsed events (Slice 2) — the discriminated union the parser
// returns. One inbound email can produce many events (digests).
// ─────────────────────────────────────────────────────────────────────

/**
 * Shared fields on every parsed event. The doc that wraps an event
 * (`ExternalShiftRequest`) carries the ingest + lifecycle metadata;
 * the event itself only carries the extracted business payload.
 */
interface IndeedFlexEventBase {
  /**
   * Indeed Flex's Job ID when present in the email body
   * (`ID: 509668` line on `new_request` and `change_time`). Absent on
   * `cancel_booking`, `change_headcount`, and `no_show` — Indeed has
   * acknowledged the gap and plans to fix it upstream. Until then,
   * downstream matching falls back to venue + role + date + time.
   */
  jobId?: string;
  /** The venue / location name as it appears in the email body. Used
   *  for fallback matching when `jobId` is absent. */
  venueName?: string;
  /** The role / position description as it appears in the email body. */
  roleName?: string;
  /** Worksite date (YYYY-MM-DD, venue-local). Used for fallback matching. */
  workDate?: string;
  /** Start time of the shift in venue-local HH:mm. */
  startTime?: string;
  /** End time of the shift in venue-local HH:mm. */
  endTime?: string;
}

export interface IndeedFlexEventNewRequest extends IndeedFlexEventBase {
  type: 'new_request';
  jobId: string;
  /** Headcount requested for this job. */
  headcount: number;
  /** Pay rate quoted in the email, in USD per hour. Optional — some
   *  templates omit it. */
  payRateUsd?: number;
}

export interface IndeedFlexEventChangeHeadcount extends IndeedFlexEventBase {
  type: 'change_headcount';
  /** Previous headcount before the change. Sometimes omitted. */
  previousHeadcount?: number;
  /** New headcount after the change. */
  newHeadcount: number;
}

export interface IndeedFlexEventChangeTime extends IndeedFlexEventBase {
  type: 'change_time';
  jobId: string;
  /** Previous shift window (HH:mm). Sometimes omitted. */
  previousStartTime?: string;
  previousEndTime?: string;
  /** New shift window. At least one of start/end is required. */
  newStartTime?: string;
  newEndTime?: string;
}

export interface IndeedFlexEventCancelBooking extends IndeedFlexEventBase {
  type: 'cancel_booking';
  /** Worker(s) whose booking was cancelled — sometimes the email lists
   *  more than one. Each entry is the literal name string from the body. */
  workerNames: string[];
  /** Cancellation reason if the email surfaces one. Free-form text. */
  reason?: string;
}

export interface IndeedFlexEventNoShow extends IndeedFlexEventBase {
  type: 'no_show';
  /** The worker who failed to show up (literal string from the email body). */
  workerName: string;
}

export interface IndeedFlexEventDailyDigestExpired extends IndeedFlexEventBase {
  type: 'daily_digest_expired';
  /** List of (jobId, venueName) pairs that expired. Both fields are
   *  optional — Indeed's digest sometimes lists venue alone. */
  expiredJobs: Array<{ jobId?: string; venueName?: string }>;
}

/**
 * Discriminated union of every event shape the parser can return.
 * Downstream code switches on `event.type` to apply the right handler.
 */
export type IndeedFlexEvent =
  | IndeedFlexEventNewRequest
  | IndeedFlexEventChangeHeadcount
  | IndeedFlexEventChangeTime
  | IndeedFlexEventCancelBooking
  | IndeedFlexEventNoShow
  | IndeedFlexEventDailyDigestExpired;

// ─────────────────────────────────────────────────────────────────────
// external_shift_requests (Slice 2)
// ─────────────────────────────────────────────────────────────────────

/**
 * Lifecycle of a row in `tenants/{tid}/external_shift_requests`.
 *
 *   needs_review  — Slice 2 parsed the event and wrote it here.
 *                   Awaiting a recruiter decision in the Recruiter UI.
 *   approved      — Recruiter approved the proposed action; Slices 3-5
 *                   pick it up and apply to the shift/JO/assignment.
 *                   Stays `approved` while the apply path is in-flight.
 *   applied       — The apply path successfully wrote the change to
 *                   the target shift. Terminal state.
 *   rejected      — Recruiter rejected the proposed action. Terminal.
 *   superseded    — A later inbound event from the same provider
 *                   replaced this one before review (e.g. two
 *                   change_headcount emails for the same shift in a
 *                   short window). The newer doc is the canonical one;
 *                   this one stays for audit. Terminal.
 */
export type ExternalShiftRequestStatus =
  | 'needs_review'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'superseded';

/**
 * Confidence level the parser assigns to the extracted payload.
 *
 *   high    — regex extracted every required field; no LLM needed.
 *   medium  — regex extracted some fields; LLM filled the rest.
 *   low     — regex found the event type but no fields; LLM extracted
 *             everything OR LLM also missed something. Recruiter
 *             should review carefully.
 */
export type ExternalShiftRequestConfidence = 'high' | 'medium' | 'low';

/**
 * Which layer produced the final payload — useful when comparing
 * extraction reliability across email formats or debugging a misparse.
 */
export type ExternalShiftRequestParseSource = 'regex' | 'llm' | 'hybrid';

/**
 * One row in `tenants/{tid}/external_shift_requests`. Created by
 * Slice 2, decided by a recruiter, applied by Slices 3-5.
 *
 * Doc ID is `${ingestEventHash}__${eventIndex}` so re-parsing the
 * same ingest event produces the same doc id (idempotent — if Slice
 * 2 retries, it overwrites the previous parse rather than creating
 * a duplicate).
 */
export interface ExternalShiftRequest {
  id: string;
  tenantId: string;
  provider: 'indeed_flex';
  /** FK back to `external_ingest_events/{eventHash}`. */
  sourceIngestEventHash: string;
  /** Position of this event in the source email's `events[]`. Zero-based. */
  eventIndex: number;

  eventType: IndeedFlexEventType;
  /** The extracted payload. Discriminated by `event.type` which equals
   *  the top-level `eventType`. */
  event: IndeedFlexEvent;

  confidence: ExternalShiftRequestConfidence;
  parseSource: ExternalShiftRequestParseSource;
  /** Free-form notes the parser attaches when something looked
   *  unusual (e.g. "regex matched 2 of 4 fields", "LLM JSON repair
   *  required"). Not displayed in the recruiter UI; ops debugging only. */
  parseNotes?: string;

  /** Matched shift doc id from the HRX side, when matching succeeded
   *  in the parser. When absent, the recruiter UI surfaces the
   *  fallback fields (venue + role + date + time) so the recruiter
   *  can pick the right shift themselves. */
  matchedShiftId?: string;
  matchedJobOrderId?: string;

  status: ExternalShiftRequestStatus;
  /** uid of the recruiter who decided. Empty until decision. */
  decidedBy?: string;
  /** ISO-8601 timestamp at decision time. */
  decidedAt?: string;
  /** Free-form note the recruiter left when approving or rejecting. */
  decisionReason?: string;

  /** ISO-8601 timestamp when Slices 3-5 successfully applied the change. */
  appliedAt?: string;
  /** Set by Slices 3-5 when application succeeded; references the
   *  target HRX shift/assignment that was modified. */
  appliedTargetId?: string;

  /** ISO-8601 timestamp. Mirrors Firestore createdAt. */
  createdAt: string;
  updatedAt: string;
}
