/**
 * Timesheet types — the V2 doc-per-row model from TS.1.
 *
 * These supersede the embedded-array `Timesheet` / `TimesheetEntry` types
 * in `src/types/phase2.ts` (now `@deprecated` — never imported anywhere
 * in the live codebase, kept only for the deprecation window). The V2
 * model uses one Firestore doc per `(assignmentId, workDate)` so:
 *   - Updates are idempotent (deterministic id `{assignmentId}_{YYYY-MM-DD}`)
 *   - Granular queries are possible (`where('workDate', '==', ...)`)
 *   - Per-row Everee responses can be captured without mutating siblings
 *   - Adjustments are sibling docs that ride the next batch via Everee Payables
 *
 * See `TS.1 — Timesheet Build Plan` (project doc) §2 for the source-of-truth
 * schema spec. Phase 1.A only formalizes types + indexes + nav; the actual
 * read/write paths arrive in P1.C onwards.
 */

import { FieldValue } from 'firebase/firestore';

/* -------------------------------------------------------------------------
 * Status state machine
 *
 * draft        — entry exists but recruiter hasn't reviewed actuals.
 * submitted    — reserved for v2 worker-self-clock flow (worker submitted,
 *                recruiter not yet reviewed). Not produced by v1 paths.
 * approved     — recruiter approved; ready to ride the next batch.
 * sent_to_everee — included in a `timesheet_batches` doc; awaiting Everee
 *                response or in-flight.
 * paid         — Everee confirmed payment. Row becomes read-only;
 *                corrections must use `TimesheetAdjustment` instead.
 * error        — Everee returned a per-row error. Tooltip exposes message;
 *                row stays editable until re-batched.
 * ------------------------------------------------------------------------- */
export type TimesheetEntryStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent_to_everee'
  | 'paid'
  | 'error';

export type TimesheetBatchStatus =
  | 'pending'
  | 'submitting'
  | 'partial'
  | 'success'
  | 'failed';

export type TimesheetAdjustmentStatus =
  | 'draft'
  | 'approved'
  | 'sent_to_everee'
  | 'paid'
  | 'error';

/* -------------------------------------------------------------------------
 * Sub-types
 * ------------------------------------------------------------------------- */

/**
 * One break inside a worked shift. `paid: true` means the break is on the
 * clock and DOES count toward worked hours (rare — typically only for
 * meal periods that the employer voluntarily pays). Most breaks are
 * `paid: false`.
 */
export interface TimesheetBreak {
  startTime: string;
  endTime: string;
  durationMins: number;
  paid: boolean;
}

/** Everee response captured per entry. All optional — populated by the
 *  `submitTimesheetBatch` orchestrator (P1.D / Phase 4) and the polling
 *  cron / webhook handlers (Phase 4). */
export interface TimesheetEntryEvereeState {
  payRunId?: string;
  /** Everee's id for the worked-shift POST that this entry produced. */
  workedShiftId?: string;
  /** Raw Everee status string — kept verbatim for debug/audit purposes. */
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  respondedAt?: Date | FieldValue;
}

export interface TimesheetBatchEvereeState {
  payRunId?: string;
  submittedAt?: Date | FieldValue;
  completedAt?: Date | FieldValue;
  errorSummary?: string;
}

export interface TimesheetAdjustmentEvereeState {
  /** Everee's payable id (adjustments use the Payables endpoint, not shifts). */
  payableId?: string;
  payRunId?: string;
  status?: string;
  error?: string;
}

/** Hours delta for adjustments — every key optional; only set the ones
 *  the correction touches. Negative numbers reduce hours (e.g. clawback). */
export interface TimesheetAdjustmentHoursDelta {
  regular?: number;
  ot?: number;
  doubleTime?: number;
}

/** Dollar deltas for adjustments. */
export interface TimesheetAdjustmentAmountDelta {
  tips?: number;
  bonus?: number;
  /** Penalty owed back to the worker (e.g. CA meal/rest break premium). */
  penalty?: number;
}

/* -------------------------------------------------------------------------
 * Top-level docs
 *
 * Path conventions:
 *   tenants/{tid}/timesheet_entries/{entryId}      — TimesheetEntryV2
 *   tenants/{tid}/timesheet_batches/{batchId}      — TimesheetBatch
 *   tenants/{tid}/timesheet_adjustments/{adjId}    — TimesheetAdjustment
 *
 * `id` mirrors the doc id. `tenantId` is denormalized so Firestore rules
 * + composite indexes can scope queries without an extra read.
 * ------------------------------------------------------------------------- */

/**
 * One worker × one workDate. Doc id is deterministic
 * `{assignmentId}_{YYYY-MM-DD}` — the orchestrator + recruiter UI can
 * upsert without a list-then-find round trip.
 */
export interface TimesheetEntryV2 {
  id: string;
  tenantId: string;
  assignmentId: string;
  jobOrderId: string;
  /** Denormalized from JobOrder for entity-scoped queries + the entity
   *  filter on `/timesheets`. */
  hiringEntityId: string;
  workerId: string;
  /** YYYY-MM-DD in the worksite's local time. */
  workDate: string;
  /** Two-letter state code. Drives the multistate pay-rules dispatch. */
  workState: string;

  /* ---------- Schedule (snapshotted from Assignment + ShiftTemplate) ---- */
  /** HH:mm. */
  scheduledStartTime: string;
  scheduledEndTime: string;
  scheduledBreakMinutes: number;

  /* ---------- Actuals (recruiter-edited) -------------------------------- */
  actualStartTime?: string;
  actualEndTime?: string;
  breaks: TimesheetBreak[];

  /* ---------- Computed (rules engine output, read-only in UI) ----------- */
  totalRegularHours: number;
  /**
   * Sum of `totalFlsaOTHours + totalNonFlsaOTHours`. Kept for
   * compatibility with consumers that don't care about the
   * federal-vs-state distinction (UI totals header, grid resolver).
   * Phase 4 Everee submission reads the split fields directly to map
   * onto `fullyClassifiedHours.type`:
   *   - FLSA → `FLSA_QUALIFIED_OVERTIME`
   *   - non-FLSA → `NON_FLSA_QUALIFIED_OVERTIME`
   */
  totalOTHours: number;
  /**
   * OT hours classified by federal weekly cascade (FLSA §207, 40h/wk).
   * Optional for backward compatibility — entries written before
   * P2.C ships may not have this field; readers should treat absent
   * as 0 and rely on the recompute trigger to backfill on next write.
   */
  totalFlsaOTHours?: number;
  /**
   * OT hours classified by state-specific daily / consecutive-day
   * rules (CA daily-8, CA 7th-day-first-8h). DEFAULT/NY/TX/MA = 0.
   * Optional for backward compatibility — see `totalFlsaOTHours`.
   */
  totalNonFlsaOTHours?: number;
  totalDoubleTimeHours: number;
  /** CA-only today; DEFAULT rule-set returns 0. */
  mealBreakPenaltyHours: number;
  /** CA-only today; DEFAULT rule-set returns 0. */
  restBreakPenaltyHours: number;

  /* ---------- Adjustments (recruiter-edited) ---------------------------- */
  tips: number;
  bonusAmount: number;
  notes?: string;

  /* ---------- Rates (snapshot from Assignment, override-able) ----------- */
  payRate: number;
  billRate: number;

  /* ---------- Status (system-managed) ----------------------------------- */
  status: TimesheetEntryStatus;
  approvedBy?: string;
  approvedAt?: Date | FieldValue;
  sentToEvereeAt?: Date | FieldValue;
  everee?: TimesheetEntryEvereeState;

  /* ---------- Audit ----------------------------------------------------- */
  createdBy: string;
  createdAt: Date | FieldValue;
  updatedBy: string;
  updatedAt: Date | FieldValue;
}

/** Scope of a batch — what slice of entries it represents. Drives the
 *  CSV export filename and the period inputs for `createPayRun`. */
export type TimesheetBatchScope =
  | { kind: 'shift'; refId: string }
  | { kind: 'jobOrder'; refId: string }
  | {
      kind: 'entity_period';
      /** Inclusive YYYY-MM-DD. */
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'custom';
      periodStart?: string;
      periodEnd?: string;
    };

/** One Everee submission. Wraps N entries; returns one Everee pay-run id. */
export interface TimesheetBatch {
  id: string;
  tenantId: string;
  hiringEntityId: string;
  scope: TimesheetBatchScope;
  /** FK to `timesheet_entries`. */
  entryIds: string[];

  status: TimesheetBatchStatus;
  everee?: TimesheetBatchEvereeState;

  totals: {
    workerCount: number;
    totalRegularHours: number;
    totalOTHours: number;
    totalGrossPay: number;
    totalGrossBill: number;
  };

  createdBy: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}

export type TimesheetAdjustmentType =
  | 'manual_correction'
  | 'dispute_resolution'
  | 'system_recompute';

/**
 * Sibling entry for post-pay corrections. Rides the next batch via the
 * Everee Payables endpoint (separate from worked-shifts because Everee
 * locks shifts after their pay run is paid).
 */
export interface TimesheetAdjustment {
  id: string;
  tenantId: string;
  /** Ref to the already-paid `TimesheetEntryV2` this adjusts. */
  originalEntryId: string;
  assignmentId: string;
  workerId: string;
  hiringEntityId: string;

  adjustmentType: TimesheetAdjustmentType;
  reason: string;

  hoursDelta: TimesheetAdjustmentHoursDelta;
  amountDelta: TimesheetAdjustmentAmountDelta;

  status: TimesheetAdjustmentStatus;
  approvedBy?: string;
  approvedAt?: Date | FieldValue;

  /** Set once the adjustment ships in a `TimesheetBatch`. */
  appliedBatchId?: string;
  everee?: TimesheetAdjustmentEvereeState;

  createdBy: string;
  createdAt: Date | FieldValue;
  updatedBy: string;
  updatedAt: Date | FieldValue;
}

/* -------------------------------------------------------------------------
 * Filter + totals types — used by `<TimesheetGrid />` (P1.C)
 *
 * Defined here (rather than co-located with the component) so backend
 * paths and CSV export utilities can share the exact same shape.
 * ------------------------------------------------------------------------- */

export type TimesheetFilter =
  | {
      kind: 'entity_period';
      hiringEntityId: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'jobOrder';
      jobOrderId: string;
      periodStart?: string;
      periodEnd?: string;
    }
  | { kind: 'shift'; shiftId: string }
  | {
      kind: 'worker';
      workerId: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'account';
      accountId: string;
      periodStart: string;
      periodEnd: string;
    };

export interface TimesheetTotals {
  workerCount: number;
  totalRegularHours: number;
  totalOTHours: number;
  totalDoubleTimeHours: number;
  totalGrossPay: number;
  totalGrossBill: number;
  byStatus: Partial<Record<TimesheetEntryStatus, number>>;
}
