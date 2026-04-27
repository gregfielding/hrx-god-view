/**
 * Build a minimal iCalendar (.ics) file for a work shift and trigger download.
 * Uses UTC timestamps (DTSTART/DTEND...Z) derived from local date/time fields.
 */

export type AssignmentIcsInput = {
  assignmentId: string;
  title: string;
  /** Plain-text description (company, notes) */
  description?: string;
  /** Location line for calendar apps */
  location?: string;
  startDate: Date;
  /** If set and after startDate (calendar day), end is on this date */
  endDate?: Date;
  /** HH:mm */
  startTime?: string;
  /** HH:mm */
  endTime?: string;
};

function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  let out = '';
  let rest = line;
  while (rest.length > 75) {
    out += `${rest.slice(0, 75)}\r\n `;
    rest = rest.slice(75);
  }
  out += rest;
  return out;
}

/** ICS UTC: YYYYMMDDTHHmmssZ */
function formatUtcIcs(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  const hh = String(dt.getUTCHours()).padStart(2, '0');
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  const ss = String(dt.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function parseHhMm(t: string | undefined): { h: number; m: number } | null {
  if (!t || typeof t !== 'string') return null;
  const parts = t.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return { h: Math.max(0, Math.min(23, h)), m: Math.max(0, Math.min(59, m)) };
}

function combineLocal(day: Date, hhmm: string | undefined): Date {
  const p = parseHhMm(hhmm);
  const h = p?.h ?? 0;
  const mi = p?.m ?? 0;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Returns start/end instants for the calendar event, or null if the assignment has no usable date.
 */
export function getAssignmentIcsEventBounds(input: AssignmentIcsInput): { start: Date; end: Date; allDay: boolean } | null {
  const { startDate, endDate, startTime, endTime } = input;
  if (!startDate || Number.isNaN(startDate.getTime())) return null;

  const hasTime = Boolean(parseHhMm(startTime) || parseHhMm(endTime));

  if (!hasTime) {
    const y = startDate.getFullYear();
    const mo = startDate.getMonth();
    const da = startDate.getDate();
    const start = new Date(y, mo, da, 0, 0, 0, 0);
    const end = new Date(y, mo, da + 1, 0, 0, 0, 0);
    return { start, end, allDay: true };
  }

  const st = combineLocal(startDate, startTime || '09:00');
  const endDayCandidate = endDate && !sameCalendarDay(endDate, startDate) ? endDate : startDate;
  let en = combineLocal(endDayCandidate, endTime || startTime || '10:00');

  if (en.getTime() <= st.getTime()) {
    en = new Date(en);
    en.setDate(en.getDate() + 1);
  }

  return { start: st, end: en, allDay: false };
}

export function buildAssignmentIcsContent(input: AssignmentIcsInput, hostForUid: string): string {
  const bounds = getAssignmentIcsEventBounds(input);
  if (!bounds) return '';

  const uid = `${input.assignmentId}@${hostForUid || 'hrx.local'}`;
  const dtStamp = formatUtcIcs(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HRX//Assignment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
  ];

  if (bounds.allDay) {
    const sd = bounds.start;
    const ed = bounds.end;
    const ds = `${sd.getFullYear()}${String(sd.getMonth() + 1).padStart(2, '0')}${String(sd.getDate()).padStart(2, '0')}`;
    const de = `${ed.getFullYear()}${String(ed.getMonth() + 1).padStart(2, '0')}${String(ed.getDate()).padStart(2, '0')}`;
    lines.push(`DTSTART;VALUE=DATE:${ds}`);
    lines.push(`DTEND;VALUE=DATE:${de}`);
  } else {
    lines.push(`DTSTART:${formatUtcIcs(bounds.start)}`);
    lines.push(`DTEND:${formatUtcIcs(bounds.end)}`);
  }

  lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(input.title || 'Shift')}`));

  const loc = (input.location || '').trim();
  if (loc) {
    lines.push(foldIcsLine(`LOCATION:${escapeIcsText(loc)}`));
  }

  const desc = (input.description || '').trim();
  if (desc) {
    lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(desc)}`));
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n');
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadAssignmentIcs(input: AssignmentIcsInput): void {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'hrx.local';
  const ics = buildAssignmentIcsContent(input, host);
  if (!ics) return;
  const safeTitle = (input.title || 'shift').replace(/[^\w-]+/g, '_').slice(0, 48);
  downloadTextFile(`assignment-${safeTitle}.ics`, ics, 'text/calendar;charset=utf-8');
}
