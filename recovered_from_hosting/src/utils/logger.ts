import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogOptions {
  context?: string;
  extra?: Record<string, any>;
  error?: any;
}

type Loggable =
  | LogOptions
  | Record<string, any>
  | string
  | number
  | boolean
  | undefined;

const ENABLE_FIRESTORE_LOGS =
  (process.env.NEXT_PUBLIC_ENABLE_FIRESTORE_LOGS || '').toLowerCase() === 'true';
const MAX_MESSAGE_CHARS = 500;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function formatError(err: any): string | undefined {
  if (!err) return undefined;
  if (typeof err === 'string') return err.slice(0, MAX_MESSAGE_CHARS);
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`.slice(0, MAX_MESSAGE_CHARS);
  }
  try {
    return JSON.stringify(err).slice(0, MAX_MESSAGE_CHARS);
  } catch {
    return undefined;
  }
}

function stringifyExtra(extra?: Record<string, any>): Record<string, any> | undefined {
  if (!extra) return undefined;
  try {
    const payload = JSON.stringify(extra);
    if (!payload || payload.length > MAX_MESSAGE_CHARS) return undefined;
    return extra;
  } catch {
    return undefined;
  }
}

async function persistSmallLog(level: LogLevel, msg: string, opts?: LogOptions) {
  if (!ENABLE_FIRESTORE_LOGS) return;
  const totalChars = msg.length + (opts?.context?.length || 0);
  if (totalChars > MAX_MESSAGE_CHARS) return;
  try {
    await addDoc(collection(db, 'system_logs'), {
      level,
      msg,
      context: opts?.context || null,
      extra: stringifyExtra(opts?.extra) || null,
      error: formatError(opts?.error) || null,
      ts: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.debug('[logger] Firestore log skipped:', err);
  }
}

function consoleLog(level: LogLevel, msg: string, opts?: LogOptions) {
  const payload = { context: opts?.context, extra: opts?.extra, error: opts?.error };
  switch (level) {
    case 'debug':
      console.debug(`[${level}] ${msg}`, payload);
      break;
    case 'info':
      console.info(`[${level}] ${msg}`, payload);
      break;
    case 'warn':
      console.warn(`[${level}] ${msg}`, payload);
      break;
    case 'error':
      console.error(`[${level}] ${msg}`, payload);
      break;
    default:
      console.log(`[log] ${msg}`, payload);
  }
}

function normalizeOptions(opts?: Loggable): LogOptions | undefined {
  if (opts === undefined) return undefined;
  if (typeof opts === 'object' && opts !== null && !Array.isArray(opts)) {
    if ('context' in opts || 'extra' in opts || 'error' in opts) {
      return opts as LogOptions;
    }
    return { extra: opts as Record<string, any> };
  }
  return { extra: { value: opts } };
}

async function log(level: LogLevel, msg: string, opts?: Loggable) {
  const normalized = normalizeOptions(opts);
  consoleLog(level, msg, normalized);
  await persistSmallLog(level, msg, normalized);
}

const AI_EXTRA_FIELDS = [
  'tenantId',
  'customerId',
  'scenarioContext',
  'eventType',
  'targetType',
  'targetId',
  'contextType',
  'aiRelevant',
  'urgencyScore',
  'versionTag',
  'metadata',
];

async function logAiEvent(payload: Record<string, any>): Promise<void> {
  if (!payload) return;
  const summaryParts = [
    payload.actionType || payload.eventType || payload.sourceModule || 'AI event',
    payload.reason,
  ].filter(Boolean);
  const message = summaryParts.join(' - ').slice(0, MAX_MESSAGE_CHARS);
  const level: LogLevel =
    payload.success === false ? 'error' : payload.success === true ? 'info' : 'debug';

  const extra: Record<string, any> = {};
  AI_EXTRA_FIELDS.forEach((field) => {
    if (payload[field] !== undefined && payload[field] !== null) {
      extra[field] = payload[field];
    }
  });
  if (payload.latencyMs !== undefined) extra.latencyMs = payload.latencyMs;
  if (payload.success !== undefined) extra.success = payload.success;

  await log(level, message || 'AI event recorded', {
    context: payload.sourceModule || payload.contextType || 'AI',
    extra: Object.keys(extra).length ? extra : undefined,
    error: payload.errorMessage,
  });
}

export const logger = {
  debug(msg: string, opts?: Loggable) {
    return log('debug', msg, opts);
  },
  info(msg: string, opts?: Loggable) {
    return log('info', msg, opts);
  },
  warn(msg: string, opts?: Loggable) {
    return log('warn', msg, opts);
  },
  error(msg: string, opts?: Loggable) {
    return log('error', msg, opts);
  },
  aiEvent(payload: Record<string, any>) {
    return logAiEvent(payload);
  },
};

export default logger;
