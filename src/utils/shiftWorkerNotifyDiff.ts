import { formatDayAndDate } from './dateSchedule';

/** Subset of persisted shift used for notify diff (avoids circular import with ShiftSetupTab). */
export type ShiftNotifyCompare = {
  shiftDate?: string;
  endDate?: string;
  shiftMode?: string;
  defaultStartTime?: string;
  defaultEndTime?: string;
  dateSchedule?: Record<string, unknown>;
  weeklySchedule?: Record<string, unknown>;
  shiftDescription?: string;
  emailIntro?: string;
};

/** Stable JSON for Firestore map fields */
function stableMapJson(m: Record<string, unknown> | undefined | null): string {
  if (!m || typeof m !== 'object') return '';
  const keys = Object.keys(m).sort();
  const o: Record<string, unknown> = {};
  keys.forEach((k) => {
    o[k] = m[k];
  });
  return JSON.stringify(o);
}

export type ShiftNotifyDiff = {
  /** True if date(s), times, or per-day schedule changed */
  scheduleChanged: boolean;
  /** True if shift-specific instructions changed (description or email intro) */
  instructionsChanged: boolean;
};

/**
 * Compare saved shift vs payload about to be written (after handleSubmit builds shiftData).
 * Ignores title, status, PO, staff counts — only times, dates, schedules, instructions.
 */
export function computeShiftNotifyDiff(
  previous: ShiftNotifyCompare | null,
  nextPayload: Record<string, unknown>
): ShiftNotifyDiff {
  if (!previous) {
    return { scheduleChanged: false, instructionsChanged: false };
  }

  const p = previous;
  const n = nextPayload;

  const scheduleChanged =
    String(p.shiftDate || '') !== String(n.shiftDate || '') ||
    String(p.endDate || '') !== String(n.endDate || '') ||
    String(p.shiftMode || 'single') !== String(n.shiftMode || 'single') ||
    String(p.defaultStartTime || '') !== String(n.defaultStartTime || '') ||
    String(p.defaultEndTime || '') !== String(n.defaultEndTime || '') ||
    stableMapJson(p.dateSchedule as Record<string, unknown>) !==
      stableMapJson((n.dateSchedule as Record<string, unknown>) || {}) ||
    stableMapJson(p.weeklySchedule as Record<string, unknown>) !==
      stableMapJson((n.weeklySchedule as Record<string, unknown>) || {});

  const instructionsChanged =
    String(p.shiftDescription || '').trim() !== String(n.shiftDescription || '').trim() ||
    String(p.emailIntro || '').trim() !== String(n.emailIntro || '').trim();

  return { scheduleChanged, instructionsChanged };
}

export function shouldPromptShiftWorkerNotify(diff: ShiftNotifyDiff): boolean {
  return diff.scheduleChanged || diff.instructionsChanged;
}

/** Human-readable schedule lines for notifications (plain text). */
export function buildScheduleNotifyText(
  shiftLike: {
    shiftMode?: string;
    shiftDate?: string;
    endDate?: string;
    defaultStartTime?: string;
    defaultEndTime?: string;
    dateSchedule?: Record<string, { startTime: string; endTime: string }>;
    weeklySchedule?: Record<string, { enabled?: boolean; startTime: string; endTime: string }>;
  },
  formatTime: (t: string) => string
): string {
  const mode = shiftLike.shiftMode === 'multi' ? 'multi' : 'single';
  const ds = shiftLike.dateSchedule;
  if (mode === 'multi' && ds && typeof ds === 'object' && Object.keys(ds).length > 0) {
    const lines = Object.keys(ds)
      .sort()
      .map((iso) => {
        const d = ds[iso];
        const st = d?.startTime ? formatTime(d.startTime) : '';
        const et = d?.endTime ? formatTime(d.endTime) : '';
        return `${formatDayAndDate(iso)}: ${st} – ${et}`;
      });
    return lines.join('\n');
  }
  if (mode === 'multi' && shiftLike.weeklySchedule) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const lines: string[] = [];
    Object.entries(shiftLike.weeklySchedule).forEach(([k, d]) => {
      if (!d?.enabled) return;
      const st = d.startTime ? formatTime(d.startTime) : '';
      const et = d.endTime ? formatTime(d.endTime) : '';
      lines.push(`${days[parseInt(k, 10) % 7] || k}: ${st} – ${et}`);
    });
    if (lines.length) return lines.join('\n');
  }
  const dateStr = shiftLike.shiftDate ? formatDayAndDate(shiftLike.shiftDate) : '';
  const st = shiftLike.defaultStartTime ? formatTime(shiftLike.defaultStartTime) : '';
  const et = shiftLike.defaultEndTime ? formatTime(shiftLike.defaultEndTime) : '';
  if (dateStr && st && et) return `${dateStr}: ${st} – ${et}`;
  return [dateStr, st && et ? `${st} – ${et}` : ''].filter(Boolean).join(' ');
}
