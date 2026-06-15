import { format } from 'date-fns';
import { getCalendarDayLocal } from './dateUtils';
import { isIsoGigDay } from './gigShiftState';

/** Format HH:mm (24h) to "7:30 AM" — aligned with Shift Setup display. */
export function formatHhMmTo12h(time: string | undefined | null): string {
  if (!time || typeof time !== 'string') return '';
  const trimmed = time.trim();
  const parts = trimmed.split(':');
  if (parts.length < 2) return trimmed;
  const hours = parseInt(parts[0], 10);
  const minutes = parts[1] ?? '00';
  if (!Number.isFinite(hours)) return trimmed;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  const mm = minutes.padStart(2, '0');
  return `${displayHour}:${mm} ${ampm}`;
}

/** Start–end label from shift doc fields (default* and legacy start/end). */
export function getShiftTimeRangeLabel(shift: Record<string, unknown> | null | undefined): string {
  if (!shift) return '';
  const start = String(shift.defaultStartTime ?? shift.startTime ?? '').trim();
  const end = String(shift.defaultEndTime ?? shift.endTime ?? '').trim();
  const a = formatHhMmTo12h(start);
  const b = formatHhMmTo12h(end);
  if (a && b) return `${a} – ${b}`;
  if (a) return a;
  if (b) return b;
  return '';
}

function formatLocalGigDay(dateStr: string): string {
  if (!isIsoGigDay(dateStr)) return dateStr || 'Unknown date';
  const [y, m, d] = dateStr.split('-').map(Number);
  return format(new Date(y, m - 1, d), 'EEE, MMM d, yyyy');
}

/**
 * Second line for gig shift pickers: date (or range) • optional time range • optional job title.
 * Times disambiguate multiple shifts on the same calendar day.
 */
export function buildShiftPickerSecondLine(
  shift: unknown,
  jobOrderJobTitle?: string | null,
): string {
  if (!shift || typeof shift !== 'object') return '';
  const s = shift as Record<string, unknown>;
  const startDateStr = getCalendarDayLocal(s.shiftDate as any);

  // Open shift: a standing-crew date range with no fixed daily times. Show
  // the range (or "ongoing" when there's no end date) and flag it clearly
  // instead of an empty time slot.
  if (s.shiftType === 'open') {
    const openEnd = s.endDate ? getCalendarDayLocal(s.endDate as any) : '';
    const dateLabel = startDateStr
      ? openEnd && openEnd !== startDateStr
        ? `${formatLocalGigDay(startDateStr)} – ${formatLocalGigDay(openEnd)}`
        : `${formatLocalGigDay(startDateStr)} – ongoing`
      : 'date range';
    const openJobTitle = String(s.defaultJobTitle ?? s.jobTitle ?? jobOrderJobTitle ?? '').trim();
    const openParts: string[] = ['Open shift (no set times)', dateLabel];
    if (openJobTitle) openParts.push(openJobTitle);
    return openParts.join(' • ');
  }

  const endDateStr =
    s.shiftMode === 'multi' &&
    s.endDate &&
    getCalendarDayLocal(s.endDate as any) !== startDateStr
      ? getCalendarDayLocal(s.endDate as any)
      : null;
  const formatted =
    startDateStr && endDateStr && startDateStr !== endDateStr
      ? `${formatLocalGigDay(startDateStr)} – ${formatLocalGigDay(endDateStr)}`
      : startDateStr
        ? formatLocalGigDay(startDateStr)
        : 'Unknown date';
  const jobTitle = String(s.defaultJobTitle ?? s.jobTitle ?? jobOrderJobTitle ?? '').trim();
  const timeRange = getShiftTimeRangeLabel(s);
  const parts: string[] = [formatted];
  if (timeRange) parts.push(timeRange);
  if (jobTitle) parts.push(jobTitle);
  return parts.join(' • ');
}
