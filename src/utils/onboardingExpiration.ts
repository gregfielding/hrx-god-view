/**
 * Expiration helpers for onboarding documents.
 * Spec: expiring_soon <= 30 days, expired = past.
 */

import type { ChecklistItemStatus, DocRecordDisplayStatus } from '../types/onboarding';

const EXPIRING_SOON_DAYS = 30;

/**
 * Derive display status from stored status and optional expiresAt.
 */
export function getDisplayStatus(
  status: ChecklistItemStatus,
  expiresAt?: Date | null
): DocRecordDisplayStatus {
  if (status === 'expired') return 'expired';
  if (status === 'missing' || status === 'submitted') return status;
  // verified (or any) with expiration
  if (expiresAt) {
    const now = new Date();
    if (expiresAt.getTime() < now.getTime()) return 'expired';
    const daysLeft = (expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    if (daysLeft <= EXPIRING_SOON_DAYS) return 'expiring_soon';
  }
  return status as DocRecordDisplayStatus;
}

/**
 * Parse Firestore Timestamp or date-like value to Date.
 */
export function parseExpiresAt(value: any): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  return null;
}

/**
 * Coerce unknown value to milliseconds since epoch. Safe for strict TS.
 * Handles: Firestore Timestamp, Date, ISO string, number millis, null/undefined.
 * Returns -1 for missing or invalid values.
 */
export function coerceToMillis(value: unknown): number {
  if (value == null) return -1;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : -1;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? -1 : parsed;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.toDate === 'function') {
      const d = (o.toDate as () => Date)();
      return d instanceof Date ? d.getTime() : -1;
    }
    if (typeof o._seconds === 'number') return o._seconds * 1000;
  }
  return -1;
}
