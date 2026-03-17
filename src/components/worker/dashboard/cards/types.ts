/**
 * Worker dashboard card types — modular card rail.
 * Priority: assignment → action-needed application → applications → profile → jobs.
 */

export type JobCategory = 'hospitality' | 'warehouse' | 'events' | 'cleaning' | 'healthcare' | 'default';

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

export type DashboardCardPayload =
  | AssignmentCardPayload
  | ApplicationCardPayload
  | ProfileCompletionCardPayload
  | JobRecommendationCardPayload;

export const CARD_THEMES = {
  assignment: { bg: '#C8DAF5', contrast: '#1a365d' },
  application: { bg: '#FEF3C7', contrast: '#92400e' },
  profile: { bg: '#CCFBF1', contrast: '#134e4a' },
  job: {
    hospitality: { bg: '#F5E6C8', contrast: '#5D4E37' },
    warehouse: { bg: '#C8DAF5', contrast: '#2C3E5C' },
    events: { bg: '#E0D4F5', contrast: '#3D2E5C' },
    cleaning: { bg: '#C8F5D8', contrast: '#2E5C3D' },
    healthcare: { bg: '#F5C8D8', contrast: '#5C2E3D' },
    default: { bg: '#E8E8E8', contrast: '#333' },
  },
} as const;
