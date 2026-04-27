export type WeeklySchedule = Record<
  string,
  { enabled: boolean; startTime: string; endTime: string }
>;

const DOWS: Array<{ dow: number; short: string }> = [
  { dow: 1, short: 'Mon' },
  { dow: 2, short: 'Tue' },
  { dow: 3, short: 'Wed' },
  { dow: 4, short: 'Thu' },
  { dow: 5, short: 'Fri' },
  { dow: 6, short: 'Sat' },
  { dow: 0, short: 'Sun' },
];

function formatTimeHHmm(time: string): string {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return time || '';
  const [hh, mm] = time.split(':').map(Number);
  const hour = hh % 12 || 12;
  const ampm = hh >= 12 ? 'PM' : 'AM';
  return `${hour}:${String(mm).padStart(2, '0')} ${ampm}`;
}

function formatDowRanges(dows: number[]): string {
  const order = new Map<number, number>(DOWS.map((d, i) => [d.dow, i]));
  const sorted = [...dows].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  const parts: string[] = [];

  // Map to linear indices for consecutive checks (Mon..Sun)
  const linear = sorted.map((d) => order.get(d) ?? 99);
  let i = 0;
  while (i < linear.length) {
    let j = i;
    while (j + 1 < linear.length && linear[j + 1] === linear[j] + 1) j++;
    const startDow = sorted[i];
    const endDow = sorted[j];
    const startLabel = DOWS.find((x) => x.dow === startDow)?.short || String(startDow);
    const endLabel = DOWS.find((x) => x.dow === endDow)?.short || String(endDow);
    parts.push(i === j ? startLabel : `${startLabel}–${endLabel}`);
    i = j + 1;
  }

  return parts.join(', ');
}

/**
 * Human summary like:
 * - "Mon–Fri 9:00 AM–5:00 PM; Wed 10:00 AM–6:00 PM"
 */
export function formatWeeklyScheduleSummary(schedule?: WeeklySchedule): string {
  if (!schedule) return '';

  const enabled: Array<{ dow: number; start: string; end: string }> = [];
  for (const { dow } of DOWS) {
    const s = schedule[String(dow)];
    if (!s?.enabled) continue;
    enabled.push({ dow, start: s.startTime, end: s.endTime });
  }
  if (enabled.length === 0) return '';

  // Group by time ranges
  const groups = new Map<string, number[]>();
  for (const d of enabled) {
    const key = `${d.start}__${d.end}`;
    const arr = groups.get(key) || [];
    arr.push(d.dow);
    groups.set(key, arr);
  }

  const parts: string[] = [];
  for (const [key, dows] of groups.entries()) {
    const [start, end] = key.split('__');
    parts.push(`${formatDowRanges(dows)} ${formatTimeHHmm(start)}–${formatTimeHHmm(end)}`);
  }

  // Prefer a stable ordering: Mon..Sun groups first by earliest day
  parts.sort((a, b) => a.localeCompare(b));
  return parts.join('; ');
}

/**
 * Returns the time range for a given local Date, using schedule day-of-week.
 * Example: "9:00 AM–5:00 PM"
 */
export function getWeeklyScheduleTimeRangeForDate(
  schedule: WeeklySchedule | undefined,
  date: Date,
): string | null {
  if (!schedule) return null;
  const s = schedule[String(date.getDay())];
  if (!s?.enabled) return null;
  if (!s.startTime || !s.endTime) return null;
  return `${formatTimeHHmm(s.startTime)}–${formatTimeHHmm(s.endTime)}`;
}

