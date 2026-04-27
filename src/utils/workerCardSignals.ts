/**
 * Worker card interaction signals for analytics and future recommendation logic.
 * Capture: dismissed, saved, expanded, applied, profile_section_completed, etc.
 * Stored in a way that can later power job recommendations and preference learning.
 */

export type WorkerCardSignalType =
  | 'job_dismissed'
  | 'job_saved'
  | 'job_expanded'
  | 'job_applied'
  | 'application_viewed'
  | 'assignment_viewed'
  | 'profile_card_completed'
  | 'profile_card_skipped'
  | 'profile_card_expanded';

export interface WorkerCardSignalPayload {
  type: WorkerCardSignalType;
  /** Entity id (jobId, applicationId, assignmentId, section id) */
  entityId?: string;
  /** Optional context (e.g. deck index, source) */
  context?: Record<string, unknown>;
  timestamp?: number;
}

const noop = () => {};

/** Optional global handler (e.g. analytics, Firestore). Set by app if needed. */
let signalHandler: (payload: WorkerCardSignalPayload) => void = noop;

export function setWorkerCardSignalHandler(handler: (payload: WorkerCardSignalPayload) => void): void {
  signalHandler = handler;
}

export function emitWorkerCardSignal(payload: Omit<WorkerCardSignalPayload, 'timestamp'>): void {
  signalHandler({
    ...payload,
    timestamp: Date.now(),
  });
}
