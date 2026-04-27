import { safeLogEvent, analytics } from '../firebase';

/**
 * Worker AI prescreen funnel — Firebase Analytics (best-effort; no-op if analytics disabled).
 */
export function logPrescreenStepViewed(params: {
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  /** Query param e.g. sms_auto_new_user, user_group_backfill */
  entry?: string | null;
  hasApplication?: boolean;
  /** True for client-only optional follow-up steps */
  isOptionalFollowup?: boolean;
}): void {
  safeLogEvent(analytics, 'prescreen_step_viewed', params as Record<string, unknown>);
}

export function logPrescreenStepCompleted(params: {
  stepId: string;
  entry?: string | null;
  hasApplication?: boolean;
}): void {
  safeLogEvent(analytics, 'prescreen_step_completed', params as Record<string, unknown>);
}

export function logPrescreenAbandoned(params: { lastStepId: string; stepIndex: number }): void {
  safeLogEvent(analytics, 'prescreen_abandoned', params as Record<string, unknown>);
}

export function logPrescreenCompleted(params: { totalSteps: number; durationMs: number }): void {
  safeLogEvent(analytics, 'prescreen_completed', params as Record<string, unknown>);
}

/** Entry query param + application context (Firebase Analytics). */
export function logPrescreenInterviewEntered(params: {
  entry: string | null;
  hasApplication: boolean;
  applicationId: string | null;
}): void {
  safeLogEvent(analytics, 'prescreen_interview_entered', params as Record<string, unknown>);
}

export function logPrescreenAdaptiveBootstrap(params: {
  reason: string;
  firstStepId: string | null;
  firstStepIndex: number;
  hadProfilePrefsPatch: boolean;
  entry?: string | null;
  hasApplication?: boolean;
}): void {
  safeLogEvent(analytics, 'prescreen_adaptive_bootstrap', params as Record<string, unknown>);
}
