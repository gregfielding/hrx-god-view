/**
 * Worker dashboard card types — modular card rail.
 * Priority: assignment → action-needed application → applications → profile → jobs.
 */

export type JobCategory =
  | 'hospitality'
  | 'warehouse'
  | 'events'
  | 'cleaning'
  | 'healthcare'
  | 'admin'
  | 'clerical'
  | 'default';

export interface AssignmentCardPayload {
  type: 'assignment';
  id: string;
  label: string;
  jobTitle: string;
  company?: string;
  dateTime: string;
  location?: string;
  pay?: number;
  status?: string;
  viewAssignmentTo: string;
  /** Address or query for Get Directions (e.g. "123 Main St, Austin, TX" or "Tortuga Festival, Fort Lauderdale") */
  directionsQuery?: string;
}

export interface ApplicationCardPayload {
  type: 'application';
  id: string;
  label: string;
  jobTitle: string;
  company?: string;
  location?: string;
  pay?: number;
  appliedDateOrStatus: string;
  viewJobTo: string;
  viewApplicationsTo: string;
  /** When true, show Accept / Decline CTAs (e.g. offer extended, hired not confirmed) */
  needsResponse?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}

export interface ProfileCompletionCardPayload {
  type: 'profile';
  id: string;
  label: string;
  readinessPercent: number;
  suggestedTasks: string[];
  continueProfileTo: string;
  seeJobsTo: string;
}

export interface JobRecommendationCardPayload {
  type: 'job';
  id: string;
  label: string;
  jobTitle: string;
  company?: string;
  dateTime?: string;
  location?: string;
  pay?: number;
  spotsLeft?: number;
  viewJobTo: string;
  applyTo?: string;
  category: JobCategory;
}

/** Gateway card: "See all jobs" — opens full jobs board. */
export interface GatewayCardPayload {
  type: 'gateway';
  id: string;
  label: string;
  seeJobsTo: string;
}

/** Job Readiness / Unlock More Jobs — dashboard card that opens the job readiness feed. */
export interface JobReadinessCardPayload {
  type: 'job_readiness';
  id: string;
  label: string;
  body: string;
  readinessPercent: number;
  blockingCount: number;
  fixNowTo: string;
}

export type DashboardCardPayload =
  | AssignmentCardPayload
  | ApplicationCardPayload
  | ProfileCompletionCardPayload
  | JobReadinessCardPayload
  | JobRecommendationCardPayload
  | GatewayCardPayload;

/** Pastel card themes: light, positive, mobile-friendly. */
export const CARD_THEMES = {
  /** Assignment cards */
  assignment: { bg: '#E8F0FE', contrast: '#2B6CB0' },
  /** Application update cards */
  application: { bg: '#F1E8FF', contrast: '#6B46C1' },
  /** Profile / readiness cards */
  profile: { bg: '#FFF4E6', contrast: '#DD6B20' },
  job_readiness: { bg: '#FFF4E6', contrast: '#DD6B20' },
  /** Action-needed (e.g. offer extended) — use application purple */
  actionNeeded: { bg: '#F1E8FF', contrast: '#6B46C1' },
  /** Cancelled / declined / expired */
  cancelled: { bg: '#E5E7EB', contrast: '#4b5563' },
  /** New job cards — single green theme */
  job: {
    hospitality: { bg: '#E8FFF5', contrast: '#0F9D58' },
    warehouse: { bg: '#E8FFF5', contrast: '#0F9D58' },
    events: { bg: '#E8FFF5', contrast: '#0F9D58' },
    cleaning: { bg: '#E8FFF5', contrast: '#0F9D58' },
    healthcare: { bg: '#E8FFF5', contrast: '#0F9D58' },
    admin: { bg: '#E8FFF5', contrast: '#0F9D58' },
    clerical: { bg: '#E8FFF5', contrast: '#0F9D58' },
    default: { bg: '#E8FFF5', contrast: '#0F9D58' },
  },
} as const;
