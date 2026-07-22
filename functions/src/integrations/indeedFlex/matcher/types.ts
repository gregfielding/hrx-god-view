/**
 * **Slice 3 — shared matcher types.**
 *
 * Each per-strategy matcher (`matchByJobId`, `matchByFallback`,
 * `matchWorkerAssignments`) takes a `MatchContext` so the production
 * code wires up Firestore once at the trigger boundary, and tests
 * pass mocks without depending on the admin SDK.
 *
 * The `Reader` shape exposes only the methods we actually use —
 * narrow surface area, easy to mock.
 */

/**
 * Lightweight "snapshot" view we return from the injected reader.
 * Production maps Firestore `DocumentSnapshot` into this; tests pass
 * canned values.
 */
export interface ReaderDoc {
  id: string;
  /** Full data — typed loosely so the reader doesn't have to know
   *  about Shift / JobOrder / Assignment shapes. */
  data: Record<string, unknown>;
}

/**
 * The narrow Firestore-like surface area each matcher consumes. One
 * tenant per call (the trigger pins it).
 */
export interface Reader {
  /** Find a JobOrder by `poNumber == jobId`. Walks the three known
   *  JO collection paths in order (matching the timesheet helper's
   *  fallback chain). Returns the first match. */
  findJobOrderByPoNumber(args: { tenantId: string; jobId: string }): Promise<ReaderDoc | null>;

  /** List shifts under a JO. Top-level `/shifts` collection — tenantId
   *  + jobOrderId scoped. Used by `matchByJobId` to find the specific
   *  shift on a given date. */
  listShiftsForJobOrder(args: {
    tenantId: string;
    jobOrderId: string;
    workDate?: string;
  }): Promise<ReaderDoc[]>;

  /** Worksite-level shift fallback when no Job ID is available. Lists
   *  shifts for a tenant on a specific date scoped to a worksite id.
   *  Used by `cancel_booking` and `change_headcount`. */
  listShiftsByWorksiteDate(args: {
    tenantId: string;
    worksiteId: string;
    workDate: string;
  }): Promise<ReaderDoc[]>;

  /** Account-level shift fallback (2026-07-20). Cancel/change venue
   *  strings ("Domino's, Colorado, 10252 E. 51st Ave…") rarely match a
   *  location doc by name, but DO resolve to an account via the alias +
   *  fuzzy venue matcher. Lists shifts on `workDate` across the
   *  account's job orders. */
  listShiftsForAccountDate(args: {
    tenantId: string;
    accountId: string;
    workDate: string;
  }): Promise<ReaderDoc[]>;

  /** Worksite lookup by literal name. Indeed's emails carry the
   *  venue display name, not an HRX worksite id — matching is a
   *  case-insensitive contains query against `name`. Returns the
   *  first match. */
  findWorksiteByName(args: { tenantId: string; venueName: string }): Promise<ReaderDoc | null>;

  /** List assignments for a shift. Used to resolve worker name →
   *  assignment id for `cancel_booking` and `no_show`. */
  listAssignmentsForShift(args: {
    tenantId: string;
    shiftId: string;
  }): Promise<ReaderDoc[]>;

  /**
   * **Venue → account match (2026-05-24).** All accounts for the
   * tenant — caller does the in-memory fuzzy match against
   * `account.name`. We could push the match into Firestore queries
   * (where('name', '>=', ...)) but the tenant only has hundreds of
   * accounts, so a single full read is simpler and more flexible.
   */
  listAccounts(args: { tenantId: string }): Promise<ReaderDoc[]>;

  /**
   * **Address index (2026-07-21, Greg's directive).** Indeed's venue
   * names rarely match HRX account names ("Maryland Warehouse" is
   * "CORT Baltimore Warehouse" in HRX), but the emails carry the
   * literal street address — the strongest signal there is. Returns
   * every known (accountId, address) pair: JO worksiteAddress rows
   * plus, for accounts without JOs, their linked company-location
   * doc. Implementations should memoize per instance — the matcher
   * may consult it several times per event.
   */
  listAccountAddresses(args: { tenantId: string }): Promise<
    Array<{
      accountId: string;
      street: string;
      city: string;
      state: string;
      zip: string;
    }>
  >;

  /**
   * Find the "inbox" Gig JO for an account — i.e. an open JO of type
   * 'gig' on `account.recruiterAccountId === accountId`. When more
   * than one matches, returns the most recently created. Used by the
   * `new_request` matcher to figure out where a single-day shift
   * would land.
   */
  findInboxGigJobOrder(args: {
    tenantId: string;
    accountId: string;
  }): Promise<ReaderDoc | null>;

  /**
   * **Venue alias short-circuit (Slice 3c, 2026-06-02).** Lookup a
   * recruiter-confirmed mapping of `rawVenueName → accountId`. When
   * present, the venue matcher returns it directly with confidence
   * `'exact'` and skips the fuzzy scoring pass. Returns `null` when no
   * alias exists for this normalized venue key.
   */
  getVenueAlias(args: {
    tenantId: string;
    rawVenueName: string;
  }): Promise<{ accountId: string; accountName: string } | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Match result
// ─────────────────────────────────────────────────────────────────────

import type { ExternalShiftRequest } from '../../../shared/indeedFlex/types';

/**
 * What every matcher returns. The dispatcher rolls this onto the
 * `external_shift_requests` doc; the trigger persists it.
 */
export interface MatchResult {
  /** First matched shift id, when exactly one resolved. Multi-match
   *  cases leave this undefined and stamp `matchConfidence: 'multiple'`. */
  matchedShiftId?: string;
  matchedJobOrderId?: string;
  /** Per-worker for `cancel_booking` / `no_show`. Order tracks the
   *  event's `workerNames[]` for `cancel_booking`. */
  matchedAssignmentIds?: string[];
  matchConfidence: NonNullable<ExternalShiftRequest['matchConfidence']>;
  matchNotes?: string;

  // ── Phase 2 (2026-05-24) — venue→account routing for `new_request` ─
  /**
   * The account this request would land on. Resolved by fuzzy-matching
   * the Indeed Flex venueName against `account.name` across all
   * accounts in the tenant. Single-day Gig requests always need an
   * account; multi-day Career requests will too (when that path lands).
   */
  matchedAccountId?: string;
  matchedAccountName?: string;
  /**
   * The "venueKey" we extracted from the email's venueName (after
   * stripping prefix/suffix codes). Helps the recruiter understand
   * what we tried to match.
   */
  venueKey?: string;
  /**
   * Other accounts that came close in the fuzzy match. Surfaced in
   * the log so the recruiter can pick a different one if our top
   * match is wrong.
   */
  candidateAccounts?: Array<{ id: string; name: string }>;
  /**
   * For `new_request`: `true` when no open Gig JO exists on the
   * matched account (so the recruiter knows the apply step will need
   * to create one before the shift can land). When `false`, the
   * matched JO id is in `matchedJobOrderId`.
   */
  wouldCreateNewJobOrder?: boolean;
}
