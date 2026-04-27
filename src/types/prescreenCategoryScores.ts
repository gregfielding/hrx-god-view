/**
 * Interview-time category score snapshot (Phase 1 worker category scoring).
 * Mirrored on `users/{uid}/interviews/{id}.ai.categoryScores` and
 * `tenants/.../applications/.../aiAutomation.categoryScores`.
 */

export const PRESCREEN_CATEGORY_IDS = [
  'reliability',
  'punctuality',
  'workEthic',
  'teamFit',
  'jobReadiness',
  'stability',
] as const;

export type PrescreenCategoryId = (typeof PRESCREEN_CATEGORY_IDS)[number];

export type PrescreenCategoryScoresV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

/** Per-category confidence 0–100 (interview evidence density + signal strength). */
export type PrescreenCategoryConfidenceV1 = {
  version: 1;
  reliability: number;
  punctuality: number;
  workEthic: number;
  teamFit: number;
  jobReadiness: number;
  stability: number;
};

/**
 * Durable evolving scores on `users/{uid}.categoryScoresCurrent`.
 * v1: plain 0–100 numbers. v2: each category has score + confidence + optional updatedAt (Firestore Timestamp).
 */
export type CategoryScoreEntryV2 = {
  score: number;
  /** 0–100 trust in this category’s score (interview-heavy starts lower; grows with real-world events). */
  confidence: number;
  updatedAt?: unknown;
};

export type PrescreenCategoryScoresV2 = {
  version: 2;
  reliability: CategoryScoreEntryV2;
  punctuality: CategoryScoreEntryV2;
  workEthic: CategoryScoreEntryV2;
  teamFit: CategoryScoreEntryV2;
  jobReadiness: CategoryScoreEntryV2;
  stability: CategoryScoreEntryV2;
};

/** @deprecated Prefer {@link PrescreenCategoryScoresV2} for new writes */
export type CategoryScoresCurrentV1 = PrescreenCategoryScoresV1;

/** Short audit tags per category (e.g. `subScores:reliability:22`, `dynamic:shift_punctuality:yes`). */
export type PrescreenCategoryEvidenceV1 = Record<PrescreenCategoryId, string[]>;
