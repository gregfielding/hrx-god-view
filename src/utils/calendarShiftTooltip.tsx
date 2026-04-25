/**
 * Shared tooltip renderer for calendar event chips/bars.
 *
 * Used by both the global /calendar view (CalendarPage) and the per-account
 * Calendar tab (AccountCalendarTab) so a hover anywhere shows the same
 * shift detail block: shift name, worksite, hours, and requested/assigned
 * counts. Returns null for events that have no HRX shift metadata
 * (Google calendar events, holidays, custom events) so the caller can
 * fall back to a no-tooltip render.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import type { CalendarEvent } from '../types/calendar';

/**
 * Format a "HH:MM" 24h string into "h:MM AM/PM". Returns null when the
 * input is empty or malformed so callers can omit the line entirely.
 */
export function formatTimeLabel(time?: string | null): string | null {
  if (!time || typeof time !== 'string') return null;
  const [hRaw, mRaw] = time.split(':');
  const h = parseInt(hRaw, 10);
  const m = parseInt(mRaw, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Tooltip contents for a calendar bar/chip: shift name, worksite,
 * shift hours, and requested/assigned counts. Gracefully skips fields
 * that aren't available (e.g. Gig job-order range bars have no
 * shift-level data, Google events have no `hrx` block at all).
 *
 * Returns null when the event has no HRX shift metadata so the caller
 * can render the chip without a Tooltip wrapper.
 */
export function renderShiftTooltip(event: CalendarEvent): React.ReactNode {
  const hrx = event.hrx;
  if (!hrx) return null;
  const worksite = hrx.worksiteName?.trim();
  const start = formatTimeLabel(hrx.shiftStartTime);
  const end = formatTimeLabel(hrx.shiftEndTime);
  const hours = start && end ? `${start} – ${end}` : start || end || null;
  const requested = typeof hrx.requestedStaff === 'number' ? hrx.requestedStaff : null;
  const assigned = typeof hrx.assignedStaff === 'number' ? hrx.assignedStaff : null;

  const hasAnything = Boolean(worksite || hours || requested != null || assigned != null);
  if (!hasAnything) return null;

  const staffLine =
    requested != null || assigned != null
      ? `${requested ?? '—'} Requested / ${assigned ?? 0} Assigned`
      : null;

  return (
    <Box sx={{ p: 0.25, fontSize: '0.75rem', lineHeight: 1.35 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.8rem', mb: 0.25 }}>
        {event.summary}
      </Typography>
      {worksite && (
        <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
          {worksite}
        </Typography>
      )}
      {hours && (
        <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
          {hours}
        </Typography>
      )}
      {staffLine && (
        <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
          {staffLine}
        </Typography>
      )}
    </Box>
  );
}
