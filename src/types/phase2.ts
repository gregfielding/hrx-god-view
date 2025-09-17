import { FieldValue } from 'firebase/firestore';

/**
 * Phase 2 Application Types
 * Supports both job-linked and standalone applications
 */

export type Application = {
  id: string;
  tenantId: string;

  // Optional linkage
  jobOrderId?: string | null;

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
};

export type ApplicationFormData = {
  // Optional linkage
  jobOrderId?: string | null;

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

export type AssignmentStatus = 'proposed' | 'confirmed' | 'active' | 'completed' | 'ended' | 'canceled';

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
}

export interface AssignmentFormData {
  jobOrderId: string;
  applicationId?: string;
  candidateId: string;
  status: AssignmentStatus;
  startDate: string;
  endDate?: string;
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
