/**
 * Compact age string for queue rows ("just now", "5m", "2h", "3d").
 * Extracted verbatim from `RecruiterMyQueue.tsx` — no "ago" suffix, no
 * "yesterday", no months/years (all four shorthand). Optimized for
 * at-a-glance scanning in dense tables.
 */

export function formatAge(ms: number, nowMs: number = Date.now()): string {
  if (!ms) return '—';
  const diff = nowMs - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/** Absolute timestamp suitable for a tooltip / `title` attribute. */
export function formatAbsoluteTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
}
