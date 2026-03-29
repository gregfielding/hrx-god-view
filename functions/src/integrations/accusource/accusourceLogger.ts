import { logger } from 'firebase-functions/v2';
import { getAccusourceConfig } from './config';

/**
 * Structured logs for AccuSource / SourceDirect. Every line is prefixed with
 * `[AccuSource][sandbox|production][tag]` and includes `accusourceEnvironment` for log filters.
 */
export function accusourceLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  tag: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  const { environment } = getAccusourceConfig();
  const line = `[AccuSource][${environment}][${tag}] ${message}`;
  const structured = { ...meta, accusourceEnvironment: environment };
  switch (level) {
    case 'info':
      logger.info(line, structured);
      break;
    case 'warn':
      logger.warn(line, structured);
      break;
    case 'error':
      logger.error(line, structured);
      break;
    case 'debug':
      logger.debug(line, structured);
      break;
    default:
      logger.info(line, structured);
  }
}
