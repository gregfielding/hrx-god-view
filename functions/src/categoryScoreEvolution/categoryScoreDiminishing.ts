/**
 * Diminishing returns on repeated similar positive events (same source + category).
 * Uses prior tally for this (source, category) before the current apply.
 */

import type { CategoryScoreEventSourceV1 } from './categoryScoreEventTypes';
import type { PrescreenCategoryId } from './prescreenCategoryScoresParse';

export function tallyKey(source: CategoryScoreEventSourceV1, category: PrescreenCategoryId): string {
  return `${source}:${category}`;
}

/**
 * Positive deltas only. sameEventCount = prior tally (0-based).
 * first → 1.0, second → ~0.67, third → 0.5, fourth → 0.4
 */
export function diminishFactorForPositiveDelta(sameEventCount: number): number {
  const t = Math.max(0, Math.min(5000, Math.floor(sameEventCount)));
  return 1 / (1 + t * 0.5);
}
