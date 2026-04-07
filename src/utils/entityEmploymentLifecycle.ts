import type { EntityEmploymentRecord } from '../pages/UserProfile/components/employment-v2/employmentV2Types';

/**
 * Normalized lowercase token for lifecycle / open-demand logic.
 * Prefer persisted `employmentState`; fall back to legacy `status`.
 */
export function entityEmploymentLifecycleLower(ee: EntityEmploymentRecord | null | undefined): string {
  return String(ee?.employmentState ?? ee?.status ?? '')
    .trim()
    .toLowerCase();
}

export function entityEmploymentStatusForDisplay(ee: EntityEmploymentRecord | null | undefined): string {
  const raw = String(ee?.employmentState ?? ee?.status ?? '').trim();
  return raw || '—';
}
