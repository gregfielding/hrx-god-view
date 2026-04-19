/**
 * Human-readable prescreen answer text for recruiter UI (no raw snake_case).
 */

import { formatDynamicAnswerValue } from '../workerAiHiringDecisionDisplay';

const ENUM_LABELS: Record<string, string> = {
  own_vehicle: 'Own vehicle',
  ride_from_someone_else: 'Ride from someone else',
  public_transportation: 'Public transportation',
  walking_biking: 'Walking / biking',
  yes: 'Yes',
  no: 'No',
  not_sure: 'Not sure',
  full_time: 'Full time',
  part_time: 'Part time',
  temporary: 'Temporary',
  gig: 'Gig',
};

function titleCaseFromSnake(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a single answer value for recruiter display.
 */
export function formatPrescreenAnswerForRecruiter(raw: unknown): string {
  if (raw == null) return '—';
  if (Array.isArray(raw)) {
    return raw
      .map((x) => formatSingleToken(String(x)))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const s = String(raw).trim();
  if (!s) return '—';
  const lower = s.toLowerCase();
  if (ENUM_LABELS[lower]) return ENUM_LABELS[lower];
  if (/^[a-z0-9_]+$/.test(s) && s.includes('_')) {
    return titleCaseFromSnake(s);
  }
  return formatDynamicAnswerValue(raw);
}

function formatSingleToken(s: string): string {
  const t = s.trim();
  const lower = t.toLowerCase();
  if (ENUM_LABELS[lower]) return ENUM_LABELS[lower];
  if (/^[a-z0-9_]+$/.test(t) && t.includes('_')) return titleCaseFromSnake(t);
  return t;
}
