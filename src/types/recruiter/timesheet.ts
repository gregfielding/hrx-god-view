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
  /** Everee externalIds for the payable(s) this entry produced (1099 /
   *  CSV-import contractor pay). Parallel to `workedShiftId` for W-2. */
  payableExternalIds?: string[];
  /** Raw Everee status string — kept verbatim for debug/audit purposes. */
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  respondedAt?: Date | FieldValue;
}

/** Lifecycle of a CSV-import row, tracked on the entry's `import` sidecar.
 *  Distinct from the canonical `TimesheetEntryStatus` so the importer's
 *  resolution states survive without polluting the payroll status enum. */
export type ImportMatchStatus =
  | 'ready'        // matched + Everee-linked + pay rate (+ WC for W-2)
  | 'needs_rate'   // matched + linked but no pay rate
  | 'needs_wc'     // W-2 matched + rate but no WC class code
  | 'blocked'      // not in HRX / not Everee-linked / ambiguous
  | 'submitted'    // sent to Everee (mirrors timesheet_import_payables)
  | 'paid'         // Everee paid it out (stamped by the payment webhook)
  | 'voided';      // retracted in Everee, re-sendable

/**
 * Import provenance + resolution state, present only on entries written by
 * the CSV timesheet importer (`source === 'csv_import'`). Lets the Grid
 * surface import rows — including blocked / unmatched ones that have no HRX
 * assignment — and lets the Import tab resume a half-finished cleanup.
 */
export interface TimesheetEntryImportState {
  /** 'indeed_flex' | 'connect_team' | … */
  customer: string;
  matchStatus: ImportMatchStatus;
  /** CSV-provided identity — shown when `workerId` is empty (unmatched). */
  csvWorkerName: string;
  csvEmail: string;
  /** CSV "Type"/site/event (the per-day pay-stub label). */
  csvSite?: string;
  csvRole?: string;
  blockReason?: string | null;
  ambiguous?: boolean;
  evereeWorkerId?: string | null;
  evereeLinked?: boolean;
  matchedByName?: boolean;
  matchedManual?: boolean;
  /** HRX display name of the linked worker (stamped on manual reassign) —
   *  the grid shows this over `csvWorkerName` so a re-pick to a
   *  differently-named person is visible immediately. */
  matchedWorkerName?: string | null;
  /** Recruiter's manual worker pick (survives re-match). */
  forcedUserId?: string | null;
  worksiteId?: string | null;
  worksiteName?: string | null;
  worksiteAddress?: { street: string; city: string; state: string; zip: string } | null;
  workersCompCode?: string | null;
  workersCompRate?: number | null;
  payRateSource?: 'assignment' | 'site_mapping' | 'account' | 'typed' | 'carried' | 'none';
  workersCompSource?: 'assignment' | 'site_mapping' | 'account' | 'typed' | 'none';
  worksiteSource?: 'assignment' | 'site_mapping' | 'account' | 'none';
  /** The Everee externalId this row maps to — joins the entry to its
   *  idempotency ledger doc (timesheet_import_payables). */
  externalId?: string;
  /** Stable CSV-derived key used in the synthetic doc id for unmatched rows. */
  csvKey?: string;
  /** Source-file row index (audit only; not stable across re-uploads). */
  rowIndex?: number;
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
  /**
   * Denormalized from `Assignment.shiftId` (TS.1.P4 Slice 5.5). Lets
   * the orchestrator filter entries by shift in one query without a
   * join, which powers the `kind: 'shift'` and per-shift batch scopes.
   * Optional during the migration window; populated by
   * `createDraftTimesheetEntryCallable` for new entries and the
   * one-shot backfill script for existing ones.
   */
  shiftId?: string;
  /**
   * Denormalized from `JobOrder.recruiterAccountId` (or `accountId` as
   * fallback), captured at entry creation via the assignment-denorm
   * trigger. Powers the `kind: 'account'` batch scope plus account-
   * scoped grid filters. Optional during migration; populated by the
   * Slice 5.5 backfill script for legacy entries.
   */
  accountId?: string;
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

  /**
   * Manual total-hours override for the day.
   *
   * Some C1 Events / C1 Workforce clients report a single "worked
   * X.XX hours" total without start/end times. The recruiter needs to
   * be able to enter that total directly (e.g. 6.25) and have it flow
   * through pay computation as Regular hours without faking shift
   * boundaries.
   *
   * Semantics:
   *   - When `actualStartTime` AND `actualEndTime` are BOTH null/empty
   *     AND this field is set, the recompute trigger treats
   *     `workedMinutes = actualHoursOverride * 60` for the day. Daily
   *     OT rules (CA daily-8, CA 7th-day-first-8h) naturally don't
   *     apply because they need time-of-day boundaries; weekly OT
   *     cascade (FLSA §207, 40h/wk) still applies because it operates
   *     on total weekly minutes regardless of source.
   *   - When `actualStartTime` AND `actualEndTime` are set, this
   *     field is IGNORED — the time-based computation wins. The UI
   *     should not surface the override as editable in that case.
   *   - Stored as decimal hours (not minutes) to match the
   *     recruiter's mental model + the input shape.
   *
   * Mutually exclusive at the UI layer with `actualStartTime` +
   * `actualEndTime`. Both stored simultaneously is permitted by the
   * schema (e.g. legacy entries) but the override silently loses to
   * the time-based path when both exist.
   */
  actualHoursOverride?: number;

  /* ---------- Computed (rules engine output, read-only in UI) ----------- */
  totalRegularHours: number;
  /**
   * Sum of `totalFlsaOTHours + totalNonFlsaOTHours`. Kept for
   * compatibility with consumers that don't care about the
   * federal-vs-state distinction (UI totals header, grid resolver).
   *
   * Phase 4 wire mapping:
   *   - Default shifts path (`fullyClassifiedHours[]`): both buckets
   *     emit as `type: 'OVERTIME'` segments — the endpoint's `type`
   *     enum is `REGULAR_TIME | OVERTIME | DOUBLE_TIME` only.
   *   - Bulk fallback (`classified-hours/bulk`): the split matters —
   *     `totalFlsaOTHours` → `flsaQualifiedOvertimeHoursWorked`,
   *     `totalNonFlsaOTHours` → `nonFlsaQualifiedOvertimeHoursWorked`,
   *     emitted as separate `ClassifiedHoursPerWorker` entries.
   */
  totalOTHours: number;
  /**
   * OT hours classified by federal weekly cascade (FLSA §207, 40h/wk).
   * See `totalOTHours` for the Phase 4 wire mapping. Optional for
   * backward compatibility — entries written before P2.C may not have
   * this field; readers should treat absent as 0 and rely on the
   * recompute trigger to backfill on next write.
   */
  totalFlsaOTHours?: number;
  /**
   * OT hours classified by state-specific daily / consecutive-day
   * rules (CA daily-8, CA 7th-day-first-8h). DEFAULT/NY/TX/MA = 0.
   * See `totalOTHours` for the Phase 4 wire mapping. Optional for
   * backward compatibility — see `totalFlsaOTHours`.
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

  /* ---------- CSV import provenance (only when imported) ---------------- */
  /** Marks an entry written by the CSV timesheet importer. The recompute
   *  trigger short-circuits on this (Everee classifies OT, not HRX), and the
   *  grid resolver surfaces these via a direct query (they often have no
   *  assignment). Absent on normal scheduled entries. */
  source?: 'csv_import';
  /** Import resolution state — present only when `source === 'csv_import'`. */
  import?: TimesheetEntryImportState;

  /* ---------- Audit ----------------------------------------------------- */
  createdBy: string;
  createdAt: Date | FieldValue;
  updatedBy: string;
  updatedAt: Date | FieldValue;
}

/**
 * Scope of a batch — what slice of entries it represents. Drives the
 * CSV export filename and the period inputs for the Everee submission.
 *
 * **Important separation of concerns.** The batch's `scope` is **metadata**
 * (used for display, CSV filename, audit trail). The actual list of
 * entries in the batch lives in `entryIds[]`. The orchestrator never
 * re-runs a scope query at submit time — it operates on the materialized
 * entryIds. Same orchestrator code handles every scope.
 *
 * Expanded in TS.1.P4 Slice 5.5 to cover the full set of natural
 * groupings a recruiter could pick from the grid:
 *
 *   - `shift`         — every entry attached to one shift
 *   - `jobOrder`      — every entry under one job order (optionally
 *                       bounded by period)
 *   - `account`       — every entry under one customer account
 *                       (optionally bounded by period)
 *   - `entity_period` — every entry for one hiring entity in a date range
 *                       (the canonical weekly payroll close)
 *   - `day`           — every entry for one hiring entity on one date
 *                       (the daily C1 Events cadence)
 *   - `worker`        — one worker's entries over a period (emergency
 *                       same-day pay, dispute resolution)
 *   - `manual`        — recruiter hand-picked some entries that don't
 *                       fit a canonical scope. Period is optional
 *                       metadata.
 *
 * The previous `kind: 'custom'` was renamed to `manual` for clarity —
 * "custom" was misleading because it suggested customization of the
 * payload, when it really just meant "hand-picked." No production
 * batches have shipped yet so the rename is safe.
 */
export type TimesheetBatchScope =
  | { kind: 'shift'; refId: string }
  | { kind: 'jobOrder'; refId: string; periodStart?: string; periodEnd?: string }
  | { kind: 'account'; refId: string; periodStart?: string; periodEnd?: string }
  | {
      kind: 'entity_period';
      /** Inclusive YYYY-MM-DD. */
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'day';
      /** YYYY-MM-DD. */
      date: string;
      /** Optional — scope-by-entity-on-date. Omit for cross-entity
       *  daily close (uncommon but supported). */
      hiringEntityId?: string;
    }
  | {
      kind: 'worker';
      workerId: string;
      periodStart: string;
      periodEnd: string;
    }
  | {
      kind: 'manual';
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
    }
  | {
      kind: 'tenant_period';
      periodStart: string;
      periodEnd: string;
      /** Hiring-entity ids whose CSV-import entries should be included.
       *  The (source, hiringEntityId, workDate) composite index requires
       *  an entity-scoped query, so tenant-wide views must enumerate. */
      hiringEntityIds?: string[];
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
