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
