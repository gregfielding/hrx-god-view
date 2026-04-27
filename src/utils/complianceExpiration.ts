/**
 * Compliance expiration and expiring-soon logic (layer on top of worker_compliance_items).
 * Does not change the compliance status enum. Used by admin UI, worker UI, and readiness.
 */
import { getComplianceTypeConfig } from '../types/compliance';
import type { WorkerComplianceItem } from '../types/compliance';

const DEFAULT_EXPIRING_SOON_DAYS = 30;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string') return new Date(value);
  return null;
}

/** True if the item is past expiration (status expired or expiresAt in the past). */
export function isExpired(item: Pick<WorkerComplianceItem, 'status' | 'expiresAt' | 'type'>): boolean {
  if (item.status === 'expired') return true;
  const config = getComplianceTypeConfig(item.type);
  if (!config?.hasExpiration) return false;
  const date = toDate(item.expiresAt);
  if (!date) return false;
  return date < new Date();
}

/** True if the item has expiration and is within thresholdDays of expiring (and not already expired). */
export function isExpiringSoon(
  item: Pick<WorkerComplianceItem, 'status' | 'expiresAt' | 'type'>,
  thresholdDays: number = DEFAULT_EXPIRING_SOON_DAYS
): boolean {
  if (item.status === 'expired' || isExpired(item)) return false;
  const config = getComplianceTypeConfig(item.type);
  if (!config?.hasExpiration) return false;
  const date = toDate(item.expiresAt);
  if (!date) return false;
  const now = new Date();
  const limit = new Date(now);
  limit.setDate(limit.getDate() + thresholdDays);
  return date <= limit;
}

/** Derived state for UI: expired → red, expiring_soon → yellow, ok → normal. */
export type ExpirationState = 'expired' | 'expiring_soon' | 'ok';

export function getExpirationState(
  item: Pick<WorkerComplianceItem, 'status' | 'expiresAt' | 'type'>,
  thresholdDays: number = DEFAULT_EXPIRING_SOON_DAYS
): ExpirationState {
  if (isExpired(item)) return 'expired';
  if (isExpiringSoon(item, thresholdDays)) return 'expiring_soon';
  return 'ok';
}

/** True if any of the items (that have expiration) are expired. */
export function hasExpiredCompliance(items: Array<Pick<WorkerComplianceItem, 'status' | 'expiresAt' | 'type'>>): boolean {
  return items.some((item) => {
    const config = getComplianceTypeConfig(item.type);
    return config?.hasExpiration === true && isExpired(item);
  });
}

/** True if any of the items (that have expiration) are expiring soon and not expired. */
export function hasExpiringSoonCompliance(
  items: Array<Pick<WorkerComplianceItem, 'status' | 'expiresAt' | 'type'>>,
  thresholdDays: number = DEFAULT_EXPIRING_SOON_DAYS
): boolean {
  return items.some((item) => {
    const config = getComplianceTypeConfig(item.type);
    return config?.hasExpiration === true && isExpiringSoon(item, thresholdDays);
  });
}

export { DEFAULT_EXPIRING_SOON_DAYS };
