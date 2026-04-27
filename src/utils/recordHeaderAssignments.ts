/**
 * Pick up to N non-terminal assignments for recruiter record header (active / upcoming).
 */

import { isAssignmentTerminalNormalized, normalizeAssignmentStatus } from './assignmentStatusNormalize';

export type RecordHeaderAssignmentLine = {
  id: string;
  /** Primary label (job order / role). */
  primary: string;
  /** Optional second line (worksite · status). */
  secondary?: string;
};

function parseStartMs(raw: unknown): number {
  if (raw == null) return NaN;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : NaN;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'object' && raw !== null && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    const d = (raw as { toDate: () => Date }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : NaN;
  }
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.getTime();
  return NaN;
}

function statusLabel(raw: unknown): string {
  const n = normalizeAssignmentStatus(String(raw ?? ''));
  const map: Record<string, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    in_progress: 'Active',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return map[n] || String(raw || '').replace(/_/g, ' ') || '—';
}

/**
 * From enriched assignment rows (`enrichUserAssignmentRow`), keep non-terminal placements
 * and prefer upcoming (future start) first, then recent active.
 */
export function pickRecordHeaderAssignments(
  enriched: Record<string, unknown>[],
  max = 3,
): RecordHeaderAssignmentLine[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const t0 = startOfToday.getTime();

  const live = enriched.filter((r) => !isAssignmentTerminalNormalized(String(r.status ?? '')));

  const decorated = live.map((r) => {
    const sm = parseStartMs(r.startDate ?? r.start_date);
    const upcoming = Number.isFinite(sm) && sm >= t0;
    return { r, sm, upcoming };
  });

  decorated.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    if (a.upcoming && b.upcoming) return a.sm - b.sm;
    if (Number.isFinite(a.sm) && Number.isFinite(b.sm)) return b.sm - a.sm;
    if (Number.isFinite(a.sm)) return -1;
    if (Number.isFinite(b.sm)) return 1;
    return 0;
  });

  return decorated.slice(0, max).map(({ r }) => {
    const job = String(r.jobOrderDisplayName || '').trim();
    const co = String(r.companyDisplayName || '').trim();
    const primary = job || co || 'Assignment';
    const ws = String(r.worksiteDisplayName || '').trim();
    const st = statusLabel(r.status);
    const parts = [ws, st].filter(Boolean);
    const secondary = parts.length ? parts.join(' · ') : undefined;
    return {
      id: String(r.id ?? ''),
      primary,
      secondary,
    };
  });
}
