import { logger } from 'firebase-functions/v2';
import { getAccusourceConfig } from './config';

const MAX_META_DEPTH = 10;
const MAX_ARRAY_ITEMS = 80;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LEN = 8000;

/**
 * Serialize an Error (and common gRPC-style fields) into plain JSON-safe fields.
 */
export function serializeErrorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { kind: 'non_error', value: String(error) };
  }
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message.slice(0, MAX_STRING_LEN),
    stack: error.stack ? error.stack.slice(0, MAX_STRING_LEN) : '',
  };
  const anyErr = error as Error & {
    code?: unknown;
    details?: unknown;
    status?: unknown;
    statusCode?: unknown;
    cause?: unknown;
  };
  if (anyErr.code !== undefined) {
    out.code = sanitizeStructuredValue(anyErr.code, 0, new WeakSet());
  }
  if (anyErr.details !== undefined) {
    out.details = sanitizeStructuredValue(anyErr.details, 0, new WeakSet());
  }
  if (anyErr.status !== undefined) {
    out.status = sanitizeStructuredValue(anyErr.status, 0, new WeakSet());
  }
  if (anyErr.statusCode !== undefined) {
    out.statusCode = sanitizeStructuredValue(anyErr.statusCode, 0, new WeakSet());
  }
  if (anyErr.cause !== undefined) {
    out.cause =
      anyErr.cause instanceof Error
        ? serializeErrorForLog(anyErr.cause)
        : sanitizeStructuredValue(anyErr.cause, 0, new WeakSet());
  }
  return out;
}

function sanitizeStructuredValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_META_DEPTH) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeErrorForLog(value);
  if (typeof value !== 'object') return value;

  const maybeJson = value as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === 'function') {
    try {
      return sanitizeStructuredValue(maybeJson.toJSON(), depth + 1, seen);
    } catch {
      return '[toJSON failed]';
    }
  }

  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    const slice = value.slice(0, MAX_ARRAY_ITEMS);
    const mapped = slice.map((v) => sanitizeStructuredValue(v, depth + 1, seen));
    seen.delete(value as object);
    if (value.length > MAX_ARRAY_ITEMS) {
      return [...mapped, `[…+${value.length - MAX_ARRAY_ITEMS} more]`];
    }
    return mapped;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).slice(0, MAX_OBJECT_KEYS);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.length > MAX_STRING_LEN) {
      out[k] = `${v.slice(0, MAX_STRING_LEN)}…[truncated]`;
    } else {
      out[k] = sanitizeStructuredValue(v, depth + 1, seen);
    }
  }
  seen.delete(value as object);
  return out;
}

function sanitizeStructuredMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return sanitizeStructuredValue(meta, 0, new WeakSet()) as Record<string, unknown>;
}

/**
 * Structured logs for AccuSource / SourceDirect. Every line is prefixed with
 * `[AccuSource][sandbox|production][tag]` and includes `accusourceEnvironment` for log filters.
 * Meta is sanitized so Error instances and circular structures never reach the Firebase logger raw.
 */
export function accusourceLog(
  level: 'info' | 'warn' | 'error' | 'debug',
  tag: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    const { environment } = getAccusourceConfig();
    const line = `[AccuSource][${environment}][${tag}] ${message}`;
    const structured: Record<string, unknown> = meta
      ? { ...sanitizeStructuredMeta(meta), accusourceEnvironment: environment }
      : { accusourceEnvironment: environment };

    switch (level) {
      case 'info':
        logger.info(line, structured);
        break;
      case 'warn':
        logger.warn(line, structured);
        break;
      case 'error':
        logger.write({
          severity: 'ERROR',
          message: line,
          ...structured,
        });
        break;
      case 'debug':
        logger.debug(line, structured);
        break;
      default:
        logger.info(line, structured);
    }
  } catch (logFailure: unknown) {
    try {
      console.error(
        '[AccuSource] accusourceLog failed',
        tag,
        message,
        serializeErrorForLog(logFailure),
      );
    } catch {
      console.error('[AccuSource] accusourceLog failed (serialize logFailure)', tag, message);
    }
  }
}
