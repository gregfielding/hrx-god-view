import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

export const getAIAnalytics = onCall(async (request) => {
  const { timeRange = '24h' } = request.data || {};
  logger.info('getAIAnalytics invoked but AI telemetry is console-only.', {
    context: 'analyticsEngine.getAIAnalytics',
    extra: { timeRange }
  });

  return {
    success: true,
    data: {
      eventFrequency: [],
      engineProcessingTimes: [],
      errorRates: [],
      performanceMetrics: {
        avgLatency: 0,
        successRate: 0,
        throughput: 0,
        errorCount: 0
      },
      topIssues: [],
      contextUsage: [],
      urgencyDistribution: [],
      engineEffectiveness: []
    },
    timeRange,
    logCount: 0,
    message: 'AI analytics are unavailable because ai_logs has been removed.'
  };
});
