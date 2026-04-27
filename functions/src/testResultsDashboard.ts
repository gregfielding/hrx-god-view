import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

export async function getTestResultsDashboard(days: number = 7) {
  logger.info('getTestResultsDashboard invoked but AI logs are disabled.', {
    context: 'testResultsDashboard.getTestResultsDashboard',
    extra: { days }
  });

  return {
    recentResults: [],
    overallStats: {
      totalRuns: 0,
      averageSuccessRate: 0,
      lastRunDate: '',
      lastRunStatus: 'unknown'
    },
    recommendations: ['Logging is disabled; scheduled test analytics are not available.']
  };
}

export const getTestDashboard = onCall(async (request) => {
  const days = request.data?.days || 7;
  const dashboard = await getTestResultsDashboard(days);
  return {
    success: true,
    dashboard,
    message: 'AI logging is disabled; dashboard contains placeholders only.'
  };
});
