import type { PrescreenCategoryId, PrescreenCategoryScoresV1, PrescreenCategoryScoresV2 } from './prescreenCategoryScoresParse';

/** Sources supported by the server processor (callable + internal emitters). */
export type CategoryScoreEventSourceV1 =
  | 'interview'
  | 'background_check'
  | 'shift_completion'
  | 'no_show'
  /** Modest worker activity signals (caps in deltaBounds). */
  | 'activity'
  /** Trusted manual / policy override path (strict caps). */
  | 'recruiter_override';

export type ApplyCategoryScoreEventInput = {
  uid: string;
  /** Opaque key; duplicate (uid, key) is a no-op (idempotent). */
  idempotencyKey: string;
  source: CategoryScoreEventSourceV1;
  referenceId?: string | null;
  /**
   * Legacy single-category apply (still supported).
   * Ignored when `categoryDeltas` is provided with at least one entry.
   */
  category?: PrescreenCategoryId | undefined;
  delta?: number | undefined;
  /**
   * Preferred: one logical event updates multiple categories (single idempotency row, one audit doc).
   */
  categoryDeltas?: Partial<Record<PrescreenCategoryId, number>>;
};

export type ApplyCategoryScoreEventResult = {
  duplicate: boolean;
  eventId?: string;
  /** Always returned as v1 numbers for backward-compatible callables. */
  categoryScoresCurrent: PrescreenCategoryScoresV1;
  /** Present when stored profile uses v2 (score + confidence per category). */
  categoryScoresCurrentV2?: PrescreenCategoryScoresV2;
  requestedDelta: number;
  appliedDelta: number;
  /** Sum of absolute applied deltas across categories (multi-category events). */
  appliedTotalAbs?: number;
  deltaClamped: boolean;
  /** True if any category had its requested delta magnitude reduced by caps / policy. */
  deltaClampedAny?: boolean;
  bootstrappedFromInterview: boolean;
  /** Requested multi-map when using categoryDeltas. */
  categoryDeltasRequested?: Partial<Record<PrescreenCategoryId, number>>;
  /** Actually applied per category after policy. */
  categoryDeltasApplied?: Partial<Record<PrescreenCategoryId, number>>;
};
