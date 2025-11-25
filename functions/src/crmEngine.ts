import { logger } from './utils/logger';

export const processWithCRMEngine = async (logData: any, logId: string): Promise<any> => {
  logger.info('processWithCRMEngine invoked but AI log storage is disabled.', {
    context: 'crmEngine.processWithCRMEngine',
    extra: { logId, eventType: logData?.eventType }
  });

  return {
    success: false,
    message: 'CRM engine insights are unavailable because ai_logs has been removed.'
  };
};
