/**
 * Category score evolution (events + profile current scores).
 *
 * - Snapshots stay on `interviews/.../ai.categoryScores` (+ optional `ai.categoryConfidence`) and `applications/.../aiAutomation`.
 * - `users/{uid}.categoryScoresCurrent` holds evolving scores (v2: per-category `score` + `confidence` + optional `updatedAt`).
 * - `users/{uid}/category_score_events/{eventId}` append-only audit trail.
 */

import type { PrescreenCategoryId } from './prescreenCategoryScores';

/** Sources that may emit category deltas (future processor). */
export type CategoryScoreEventSource =
  | 'interview'
  | 'shift_completion'
  | 'no_show'
  | 'background_check'
  | 'activity'
  | 'recruiter_override';

/**
 * Document shape for `users/{uid}/category_score_events/{eventId}`.
 * `createdAt` is a Firestore Timestamp in production; clients treat as unknown until converted.
 */
export type CategoryScoreEventDoc = {
  /** Primary category for legacy single-delta events; may be null when only `appliedCategoryDeltas` is used. */
  category: PrescreenCategoryId | null;
  /**
   * Effective delta applied to the category after server bounds (legacy readers may still use `delta`).
   * Prefer `appliedDelta` when present.
   */
  delta?: number;
  appliedDelta?: number;
  requestedDelta?: number;
  deltaClamped?: boolean;
  source: CategoryScoreEventSource;
  referenceId?: string | null;
  createdAt: unknown;
  /** SHA-256 (hex) of `${uid}\\n${idempotencyKey}` — matches `category_score_event_keys` doc id. */
  idempotencyKeySha256?: string;
  previousValue?: number;
  newValue?: number;
  bootstrappedFromInterview?: boolean;
  /** Multi-category (preferred): requested and applied deltas per category. */
  categoryDeltas?: Partial<Record<PrescreenCategoryId, number>>;
  appliedCategoryDeltas?: Partial<Record<PrescreenCategoryId, number>>;
  appliedTotalAbs?: number;
  requestedTotalAbs?: number;
  deltaClampedAny?: boolean;
  policyVersion?: string;
  /** Per-category score/confidence movement for explainability. */
  scoreAudit?: Record<
    string,
    { scoreFrom: number; scoreTo: number; confidenceFrom: number; confidenceTo: number }
  >;
};
