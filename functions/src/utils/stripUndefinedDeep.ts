import * as admin from 'firebase-admin';

/**
 * Firestore rejects `undefined` anywhere in document data. Remove keys whose value is
 * `undefined` recursively (plain objects only). Preserves FieldValue, Date, Timestamp-like.
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof admin.firestore.FieldValue) {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  const maybeTs = value as { seconds?: number; nanoseconds?: number; toDate?: () => Date };
  if (typeof maybeTs.toDate === 'function' && typeof maybeTs.seconds === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    const arr = value
      .map((v) => stripUndefinedDeep(v))
      .filter((v) => v !== undefined) as unknown[];
    return arr as unknown as T;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const nv = stripUndefinedDeep(v);
    if (nv !== undefined) {
      out[k] = nv;
    }
  }
  return out as T;
}
