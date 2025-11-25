import * as admin from 'firebase-admin';

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
  (process.env.ENABLE_FIRESTORE_LOGS || '').toLowerCase() === 'true';
const IS_PROD = process.env.NODE_ENV === 'production';
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
    const json = JSON.stringify(extra);
    if (!json || json.length > MAX_MESSAGE_CHARS) return undefined;
    return extra;
  } catch {
    return undefined;
  }
}

async function persistSmallLog(level: LogLevel, msg: string, opts?: LogOptions): Promise<void> {
  if (!ENABLE_FIRESTORE_LOGS) return;
  const textLength = msg.length + (opts?.context?.length || 0);
  if (textLength > MAX_MESSAGE_CHARS) {
    return;
  }
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();
  const now = Date.now();
  const doc = {
    level,
    msg,
    context: opts?.context || null,
    extra: stringifyExtra(opts?.extra) || null,
    error: formatError(opts?.error) || null,
    ts: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(now + TTL_MS),
  };
  await db.collection('system_logs').add(doc);
}

function consoleLog(level: LogLevel, msg: string, opts?: LogOptions) {
  const payload = {
    context: opts?.context,
    extra: opts?.extra,
    error: opts?.error,
  };
  const consoleArgs: any[] = [`[${level.toUpperCase()}] ${msg}`];
  if (!IS_PROD || level !== 'debug') {
    consoleArgs.push(payload);
  }
  switch (level) {
    case 'debug':
      console.debug(...consoleArgs);
      break;
    case 'info':
      console.info(...consoleArgs);
      break;
    case 'warn':
      console.warn(...consoleArgs);
      break;
    case 'error':
      console.error(...consoleArgs);
      break;
    default:
      console.log(...consoleArgs);
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

async function log(level: LogLevel, msg: string, opts?: Loggable): Promise<void> {
  const normalized = normalizeOptions(opts);
  consoleLog(level, msg, normalized);
  try {
    await persistSmallLog(level, msg, normalized);
  } catch (err) {
    console.debug('[logger] Firestore log skipped:', err instanceof Error ? err.message : err);
  }
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


