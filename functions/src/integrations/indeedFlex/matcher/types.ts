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
}
