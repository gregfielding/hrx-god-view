import { normalizeAssignmentStatus } from '../utils/assignmentStatusNormalize';

export const SYSTEM_TRIGGER_KEYS = {
  /** Labor pool / pre-assignment hire started via `startOnCallEmployment` or `startOnCallOnboarding`. */
  onCallEmploymentStarted: 'on_call_employment_started',
  /** First creation of `worker_onboarding` for worker + entity (any source: manual, on-call, assignment, etc.). */
  workerOnboardingPipelineStarted: 'worker_onboarding_pipeline_started',
  /**
   * Payroll portal / onboarding invite (TempWorks, etc.). Fired from on-call payroll automation and
   * assignment-confirmed payroll slice. Pair with message type `payroll_onboarding_invite_needed`.
   */
  payrollOnboardingInviteNeeded: 'payroll_onboarding_invite_needed',
  accountCreated: 'account_created',
  applicationReceived: 'application_received',
  applicationStatusScreened: 'application_status_screened',
  applicationStatusAdvanced: 'application_status_advanced',
  applicationStatusInterview: 'application_status_interview',
  applicationStatusOffer: 'application_status_offer',
  applicationStatusHired: 'application_status_hired',
  applicationStatusRejected: 'application_status_rejected',
  applicationStatusWaitlisted: 'application_status_waitlisted',
  assignmentCreated: 'assignment_created',
  assignmentStatusConfirmed: 'assignment_status_confirmed',
  assignmentStatusActive: 'assignment_status_active',
  assignmentStatusCompleted: 'assignment_status_completed',
  assignmentStatusCancelled: 'assignment_status_cancelled',
} as const;

export type SystemTriggerKey = typeof SYSTEM_TRIGGER_KEYS[keyof typeof SYSTEM_TRIGGER_KEYS];

export interface TriggerCatalogEntry {
  key: SystemTriggerKey;
  label: string;
  description: string;
}

export const SYSTEM_TRIGGER_CATALOG: TriggerCatalogEntry[] = [
  {
    key: SYSTEM_TRIGGER_KEYS.onCallEmploymentStarted,
    label: 'On-call employment started',
    description:
      'Runs when a recruiter starts on-call / labor-pool employment for a worker and hiring entity (no assignment). Pair with message type on_call_employment_started.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.payrollOnboardingInviteNeeded,
    label: 'Payroll onboarding invite needed',
    description:
      'Runs when the system sends a payroll signup / portal invite (on-call hire or assignment confirmed). Pair with message type payroll_onboarding_invite_needed. If no active rule exists, a default body is sent.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.workerOnboardingPipelineStarted,
    label: 'Worker onboarding pipeline started',
    description:
      'Runs the first time a worker onboarding pipeline is created for a hiring entity (recruiter manual/on-call, worker/recruiter assignment confirmation, or assignment-confirmed automation). Optional assignment/job fields are filled when available.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.accountCreated,
    label: 'Account Created',
    description: 'Runs when a new user account is created.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationReceived,
    label: 'Application Received',
    description: 'Runs when a candidate submits an application.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusScreened,
    label: 'Application Screened',
    description: 'Runs when an application status changes to screened.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusAdvanced,
    label: 'Application Advanced',
    description: 'Runs when an application status changes to advanced.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusInterview,
    label: 'Application Interview',
    description: 'Runs when an application status changes to interview.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusOffer,
    label: 'Application Offer',
    description: 'Runs when an application status changes to offer.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusHired,
    label: 'Application Hired',
    description: 'Runs when an application status changes to hired.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusRejected,
    label: 'Application Rejected',
    description: 'Runs when an application status changes to rejected.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.applicationStatusWaitlisted,
    label: 'Application Waitlisted',
    description: 'Runs when an application status changes to waitlisted.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.assignmentCreated,
    label: 'Assignment Created',
    description: 'Runs when an assignment is created.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.assignmentStatusConfirmed,
    label: 'Assignment Confirmed',
    description: 'Runs when an assignment status changes to confirmed.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.assignmentStatusActive,
    label: 'Assignment Active',
    description: 'Runs when an assignment status changes to active.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.assignmentStatusCompleted,
    label: 'Assignment Completed',
    description: 'Runs when an assignment status changes to completed.',
  },
  {
    key: SYSTEM_TRIGGER_KEYS.assignmentStatusCancelled,
    label: 'Assignment Cancelled',
    description: 'Runs when an assignment status changes to cancelled/canceled.',
  },
];

const SYSTEM_TRIGGER_KEY_VALUES = new Set<string>(
  Object.values(SYSTEM_TRIGGER_KEYS) as string[],
);

/** Allow any key declared on {@link SYSTEM_TRIGGER_KEYS} (not only catalog rows) so API validation cannot drift from dispatch code. */
export function isSystemTriggerKey(value: string): value is SystemTriggerKey {
  return SYSTEM_TRIGGER_KEY_VALUES.has(value);
}

export function mapApplicationStatusToTriggerKey(status: string): SystemTriggerKey | null {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'screened') return SYSTEM_TRIGGER_KEYS.applicationStatusScreened;
  if (normalized === 'advanced') return SYSTEM_TRIGGER_KEYS.applicationStatusAdvanced;
  if (normalized === 'interview') return SYSTEM_TRIGGER_KEYS.applicationStatusInterview;
  if (normalized === 'offer') return SYSTEM_TRIGGER_KEYS.applicationStatusOffer;
  if (normalized === 'hired') return SYSTEM_TRIGGER_KEYS.applicationStatusHired;
  if (normalized === 'rejected') return SYSTEM_TRIGGER_KEYS.applicationStatusRejected;
  if (normalized === 'waitlisted') return SYSTEM_TRIGGER_KEYS.applicationStatusWaitlisted;
  return null;
}

export function mapAssignmentStatusToTriggerKey(status: string): SystemTriggerKey | null {
  const n = normalizeAssignmentStatus(status);
  if (n === 'confirmed') return SYSTEM_TRIGGER_KEYS.assignmentStatusConfirmed;
  if (n === 'in_progress') return SYSTEM_TRIGGER_KEYS.assignmentStatusActive;
  if (n === 'completed') return SYSTEM_TRIGGER_KEYS.assignmentStatusCompleted;
  if (n === 'cancelled') return SYSTEM_TRIGGER_KEYS.assignmentStatusCancelled;
  return null;
}
