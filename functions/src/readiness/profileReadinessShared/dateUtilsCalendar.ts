export type CalendarDayLocalInput = string | Date | { toDate?: () => Date } | null | undefined;

export function getCalendarDayLocal(shiftDate: CalendarDayLocalInput): string {
  if (shiftDate == null || shiftDate === '') return '';
  if (typeof shiftDate === 'string') {
    const dateOnly = shiftDate.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  }
  try {
    let date: Date;
    if (typeof shiftDate === 'string') {
      date = new Date(shiftDate);
    } else if (shiftDate && typeof (shiftDate as { toDate?: () => Date }).toDate === 'function') {
      date = (shiftDate as { toDate: () => Date }).toDate();
    } else if (shiftDate instanceof Date) {
      date = shiftDate;
    } else {
      return '';
    }
    if (isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

export function parseCalendarDateLocal(value: CalendarDayLocalInput): Date | undefined {
  const dayStr = getCalendarDayLocal(value);
  if (!dayStr || !/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) return undefined;
  const [y, m, d] = dayStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? undefined : date;
}
