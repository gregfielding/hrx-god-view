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
   * Keys are JS day-of-week numbers as strings: 0=Sun ... 6=Sat
   */
  weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
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
}

export interface AssignmentFormData {
  jobOrderId: string;
  applicationId?: string;
  candidateId: string;
  status: AssignmentStatus;
  startDate: string;
  endDate?: string;
  weeklySchedule?: Record<string, { enabled: boolean; startTime: string; endTime: string }>;
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
