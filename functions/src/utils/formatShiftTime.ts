/**
 * Format a "HH:mm" 24-hour shift-time string as 12-hour AM/PM.
 *   "17:00" → "5:00 PM"   "23:30" → "11:30 PM"
 *   "00:00" → "12:00 AM"  "12:00" → "12:00 PM"
 *
 * Worker-facing SMS should read as AM/PM, not military time. Shift times
 * are stored as "HH:mm" strings; this is the backend counterpart to the
 * client's `formatTime12h` in `src/utils/shifts/shiftRow.ts`.
 *
 * Returns the original string if it can't be parsed (defensive — never
 * blanks a time out of a message), and `null` for empty input.
 */
export function formatTime12h(time?: string | null): string | null {
  if (!time) return null;
  const raw = String(time).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return raw;
  let h = parseInt(m[1], 10);
  const min = m[2];
  if (Number.isNaN(h) || h < 0 || h > 23) return raw;
  const meridiem = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${meridiem}`;
}
