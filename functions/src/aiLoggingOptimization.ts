import { logger } from './utils/logger';

/**
 * Legacy AI logging optimizer — all functionality is now handled by the centralized logger.
 * The helpers exported below remain for compatibility,but they no longer touch Firestore.
 */

export function shouldLogEvent(): boolean {
  // Always return false so any lingering callers skip Firestore writes.
  return false;
}

export async function checkRateLimiting(): Promise<boolean> {
  // Rate limiting is irrelevant once Firestore logging is disabled.
  return true;
}

export async function updateRateLimiting(): Promise<void> {
  // No-op.
}

export async function writeOptimizedLog(logData: Record<string, unknown>): Promise<{ success: boolean }> {
  logger.info('writeOptimizedLog invoked after Firestore logging shutdown.', {
    context: 'aiLoggingOptimization.writeOptimizedLog',
    extra: logData
  });
  return { success: false };
}

export async function benchmarkLogCost(): Promise<{ perLogCostUsd: number }> {
  return { perLogCostUsd: 0 };
}
