import { safeLogEvent, analytics } from '../firebase';

/**
 * Apply-wizard signup funnel — Firebase Analytics (best-effort; no-op when
 * analytics is disabled). Mirrors prescreenAnalytics.ts. Read in GA4:
 * funnel exploration over apply_step_viewed → apply_step_completed →
 * apply_completed, segmented by jobId / signupSource.
 */
export interface ApplyStepParams {
  /** Stable step id (personal_info, address, resume, …) — see STEP_IDS in Wizard. */
  stepId: string;
  /** Position within the CURRENT visible flow (steps self-filter per user). */
  stepIndex: number;
  totalSteps: number;
  /** Job-board application vs generic signup. */
  jobId?: string | null;
  signupSource?: string | null;
  authed?: boolean;
}

export function logApplyStepViewed(params: ApplyStepParams): void {
  safeLogEvent(analytics, 'apply_step_viewed', params as unknown as Record<string, unknown>);
}

export function logApplyStepCompleted(params: ApplyStepParams): void {
  safeLogEvent(analytics, 'apply_step_completed', params as unknown as Record<string, unknown>);
}

export function logApplyAbandoned(params: {
  lastStepId: string;
  stepIndex: number;
  jobId?: string | null;
  signupSource?: string | null;
}): void {
  safeLogEvent(analytics, 'apply_abandoned', params as unknown as Record<string, unknown>);
}

export function logApplyCompleted(params: {
  totalSteps: number;
  durationMs: number;
  jobId?: string | null;
  signupSource?: string | null;
}): void {
  safeLogEvent(analytics, 'apply_completed', params as unknown as Record<string, unknown>);
}
