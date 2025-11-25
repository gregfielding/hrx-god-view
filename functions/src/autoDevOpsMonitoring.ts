import { onCall } from 'firebase-functions/v2/https';
import { logger } from './utils/logger';

const disabledMessage =
  'AutoDevOps monitoring relied on the deprecated ai_logs collection. Logging has moved to console-only, so this endpoint now returns a stub response.';

const buildResponse = (feature: string) => {
  logger.info(`${feature} invoked but monitoring is disabled.`, {
    context: 'autoDevOpsMonitoring',
    extra: { feature }
  });
  return {
    success: false,
    data: null,
    message: disabledMessage
  };
};

export const collectAutoDevOpsMetrics = onCall(async () => buildResponse('collectAutoDevOpsMetrics'));

export const getRealTimeMetrics = onCall(async () => ({
  success: true,
  data: {
    lastRunTime: null,
    isCurrentlyRunning: false,
    systemStatus: 'idle'
  },
  message: disabledMessage
}));

export const getPerformanceDashboard = onCall(async () => buildResponse('getPerformanceDashboard'));

export const getLatestAutoDevOpsMetrics = onCall(async () => buildResponse('getLatestAutoDevOpsMetrics'));

export const monitorBuildDeploymentErrors = onCall(async () => buildResponse('monitorBuildDeploymentErrors'));

export const monitorAIEngineProcessing = onCall(async () => buildResponse('monitorAIEngineProcessing'));

export const monitorLoggingErrors = onCall(async () => buildResponse('monitorLoggingErrors'));

export const monitorAIEngineProcessingWithSelfHealing = onCall(async () => buildResponse('monitorAIEngineProcessingWithSelfHealing'));

export const getLoggingErrorStats = onCall(async () => buildResponse('getLoggingErrorStats'));
