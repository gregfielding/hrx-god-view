/**
 * Firestore rejects `undefined`, and numeric `NaN` / `Infinity` in field values.
 * Use before `update()` / `set()` when merging objects built from optional TS fields.
 */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export function sanitizeForFirestoreWrite(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof FieldValue || value instanceof Timestamp) return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForFirestoreWrite(v));
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = sanitizeForFirestoreWrite(v);
  }
  return out;
}
