import { FieldValue } from 'firebase/firestore';
import type { AssignmentAttendanceOutcome, NoShowRiskPredictionV1 } from './noShowRisk';
import type { ApplicationHiringLifecycle } from './applicationHiringLifecycle';

/**
 * Phase 2 Application Types
 * Supports both job-linked and standalone applications
 */

export type Application = {
  id: string;
  tenantId: string;

  // Optional linkage
  jobOrderId?: string | null;
  userId?: string;
  candidateId?: string;
  jobId?: string | null;
  postId?: string | null;
  shiftId?: string | null;
  shiftIds?: string[];
  selectedShifts?: unknown[];
  /** Career-only: which of the JO's 2+ open shifts the applicant said they want,
   *  when the posting offered a choice (single open shift = no choice needed,
   *  this stays unset). Informational only — unlike gig `shiftId`/`shiftIds`,
   *  it carries no day/spot-limit semantics; the recruiter still manually
   *  assigns the shift in Placements. */
  preferredShiftId?: string | null;

  // Candidate core
  candidate: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    country?: string;
    resumeUrl?: string;
  };

  // Pipeline
  status: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
  stageChangedAt: Date | FieldValue;

  // Meta
  createdAt: Date | FieldValue;
  createdBy: string;
  updatedAt: Date | FieldValue;
  updatedBy?: string;

  // Scoring / labels
  rating?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  notes?: string;

  // Compliance snapshot
  requires: {
    backgroundCheck?: boolean;
    drugScreen?: boolean;
    licenses?: string[];
  };

  // Audit
  source?: 'job_board' | 'manual' | 'referral' | 'import' | 'career_page';

  /** Dual-written funnel snapshot (canonical stages in `shared/hiringLifecycleTypes.ts`). */
  hiringLifecycle?: ApplicationHiringLifecycle;
};

export type ApplicationFormData = {
  // Optional linkage
  jobOrderId?: string | null;
  userId?: string;
  candidateId?: string;
  jobId?: string | null;
  postId?: string | null;
  shiftId?: string | null;
  shiftIds?: string[];
  selectedShifts?: unknown[];
  /** See `Application.preferredShiftId` — same career-only, informational meaning. */
  preferredShiftId?: string | null;

  // Candidate core
  candidate: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    city?: string;
    state?: string;
    country?: string;
    resumeUrl?: string;
  };

  // Pipeline
  status: 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';

  // Scoring / labels
  rating?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  notes?: string;

  // Compliance snapshot
  requires: {
    backgroundCheck?: boolean;
    drugScreen?: boolean;
    licenses?: string[];
  };

  // Audit
  source?: 'job_board' | 'manual' | 'referral' | 'import' | 'career_page';
};

export type ApplicationStage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';

export type ApplicationSource = 'job_board' | 'manual' | 'referral' | 'import' | 'career_page';

export type ApplicationRating = 1 | 2 | 3 | 4 | 5;

export interface ApplicationFilters {
  status?: ApplicationStage;
  jobOrderId?: string;
  source?: ApplicationSource;
  rating?: ApplicationRating;
  tags?: string[];
  search?: string;
}

export interface ApplicationSortOptions {
  field: 'createdAt' | 'stageChangedAt' | 'candidate.lastName' | 'rating';
  direction: 'asc' | 'desc';
}

// ============================================================================
// PHASE 2.2 - ASSIGNMENTS & SCHEDULING TYPES
// ============================================================================

/** Canonical values written by new code; legacy strings may still exist in Firestore until backfilled. */
export type AssignmentStatusCanonical = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export type AssignmentStatus =
  | AssignmentStatusCanonical
  | 'proposed'
  | 'declined'
  | 'active'
  | 'ended'
  | 'canceled';

export type TimesheetMode = 'mobile' | 'kiosk' | 'paper';

export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface Assignment {
  id: string;
  tenantId: string;
  jobOrderId: string;
  applicationId?: string; // Link if sourced from an application
  candidateId: string;
  status: AssignmentStatus;
  startDate: string; // ISO date
  endDate?: string; // Optional, blank if indefinite
  /**
   * Optional weekly schedule for multi-day assignments.
   * Keys are JS day-of-week numbers as strings: 0=Sun ... 6=Sat.
   *
   * `workersNeeded` and `overstaff` are optional per-day staffing overrides
   * for Career (recurring) shifts. When unset, displays/finance fall back to
   * shift-level `totalStaffRequested` / `overstaffCount`. Note: shift-fill
   * automation is still shift-level — these fields capture *intent* and feed
   * calendar/finance display only.
   */
  weeklySchedule?: Record<
    string,
    { enabled: boolean; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
  >;
  payRate: number; // Decimal, tenant currency
  billRate: number; // Decimal, tenant currency
  worksite: string; // Ref to company_locations/{id}
  shiftTemplateId?: string; // Optional
  timesheetMode: TimesheetMode;
  createdBy: string; // userId
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
  updatedBy?: string;
  notes?: string;

  /** Rules-based assignment-level no-show risk (see Cloud Functions `computeNoShowRiskForAssignment`). */
  noShowRiskPredictionV1?: NoShowRiskPredictionV1;
  /** Recorded attendance for reporting and model training; default in UI is `unknown`. */
  attendanceOutcome?: AssignmentAttendanceOutcome;
  attendanceRecordedAt?: Date | FieldValue;
  attendanceRecordedBy?: string;

  /* ---------------------------------------------------------------------
   * TS.1.P1.B — Timesheet denormalization fields (all optional).
   *
   * Cuts the timesheet grid's per-row fetch tree from ~5 reads
   * (assignment → JO → entity → worksite → user → shift template) down
   * to ~2 (assignment + entries). Populated by the one-shot backfill
   * `backfillAssignmentDenormFieldsCallable` for existing assignments;
   * new assignments rely on the same backfill being re-run after a
   * deploy until a write-time hook is added (deferred — see TS.1
   * follow-up question 3).
   *
   * Every field is intentionally optional + best-effort — when a source
   * doc is missing or malformed, the backfill leaves the field unset and
   * the grid does its own runtime lookup. Stored values are never
   * overridden by re-runs (idempotent).
   * ------------------------------------------------------------------ */

  /** Hiring entity that owns this assignment (denormalized from JO chain).
   *  Resolution path mirrors R.4.2's `resolveLegacyAssignmentHiringEntityId`. */
  hiringEntityId?: string;
  /** Two-letter state code of the worksite — drives multistate pay rules. */
  worksiteState?: string;
  /** Recruiter-friendly worksite label for grid grouping headers. */
  worksiteDisplayName?: string;
  /** Worker's display name (denormalized from `users/{userId}`). */
  workerDisplayName?: string;
  /** Default break minutes from the linked Shift / position — used to
   *  seed `scheduledBreakMinutes` on new TimesheetEntryV2 docs. */
  shiftBreakDefaultMinutes?: number;
  /** Mirrors the latest TimesheetEntryV2.status for fast filter queries
   *  on the recruiter dashboard. Populated by P1.D triggers, never by
   *  the backfill (no entries exist at backfill time). */
  latestTimesheetStatus?:
    | 'draft'
    | 'submitted'
    | 'approved'
    | 'sent_to_everee'
    | 'paid'
    | 'error';
}

export interface AssignmentFormData {
  jobOrderId: string;
  applicationId?: string;
  candidateId: string;
  status: AssignmentStatus;
  startDate: string;
  endDate?: string;
  weeklySchedule?: Record<
    string,
    { enabled: boolean; startTime: string; endTime: string; workersNeeded?: number; overstaff?: number }
  >;
  payRate: number;
  billRate: number;
  worksite: string;
  shiftTemplateId?: string;
  timesheetMode: TimesheetMode;
  notes?: string;
}

export interface ShiftTemplate {
  id: string;
  tenantId: string;
  jobOrderId?: string;
  name: string;
  daysOfWeek: DayOfWeek[];
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  breakRules?: {
    breakDuration: number; // minutes
    breakFrequency: number; // hours
    unpaidBreaks: boolean;
  };
  createdBy: string;
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}

export interface ShiftTemplateFormData {
  jobOrderId?: string;
  name: string;
  daysOfWeek: DayOfWeek[];
  startTime: string;
  endTime: string;
  breakRules?: {
    breakDuration: number;
    breakFrequency: number;
    unpaidBreaks: boolean;
  };
}

/**
 * @deprecated Embedded-array timesheet model — never used in the live
 * codebase (zero non-test imports as of TS.1.P1.A). Superseded by the
 * doc-per-row V2 model in `src/types/recruiter/timesheet.ts`
 * (`TimesheetEntryV2`, `TimesheetBatch`, `TimesheetAdjustment`).
 *
 * Kept here only for the deprecation window so an inadvertent old import
 * doesn't immediately break a build. Delete in the cleanup PR after TS.1
 * launch — verify zero imports first with
 * `rg "from .*phase2.*\bTimesheet(Entry)?\b"` and confirm zero matches.
 */
export interface TimesheetEntry {
  date: string; // ISO date
  clockIn?: string; // HH:mm format
  clockOut?: string; // HH:mm format
  breaks: {
    start: string;
    end: string;
    duration: number; // minutes
    paid: boolean;
  }[];
  totalHours?: number;
  notes?: string;
}

/**
 * @deprecated See `TimesheetEntry` above — same deprecation notice. Replaced
 * by `TimesheetEntryV2` + `TimesheetBatch` in `src/types/recruiter/timesheet.ts`.
 */
export interface Timesheet {
  id: string;
  tenantId: string;
  assignmentId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  entries: TimesheetEntry[];
  submittedBy?: string;
  approvedBy?: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  createdAt: Date | FieldValue;
  updatedAt: Date | FieldValue;
}

export interface AssignmentFilters {
  status?: AssignmentStatus;
  candidateId?: string;
  jobOrderId?: string;
  worksite?: string;
  shiftTemplateId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface AssignmentSortOptions {
  field: 'startDate' | 'endDate' | 'createdAt' | 'candidate.lastName' | 'status';
  direction: 'asc' | 'desc';
}
