/**
 * Worker schedule calendar (upcoming + past + available shifts combined).
 * Day / Week / Month views. Click a shift to open its assignment detail
 * (confirmed) or the jobs-board posting (accepted / submitted / available).
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { useNavigate } from 'react-router-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { enUS, es as esLocale } from 'date-fns/locale';
import { useT, getLanguage } from '../../../i18n';
import type { WorkerAssignmentItem } from './WorkerAssignmentCard';

export interface WorkerAssignmentsCalendarProps {
  assignments: WorkerAssignmentItem[];
}

type CalendarView = 'day' | 'week' | 'month';
const MAX_VISIBLE_PER_CELL = 4;

function startMs(a: WorkerAssignmentItem): number {
  const v = a.startAt;
  return typeof v === 'number' ? v : new Date(v).getTime();
}

/** Compact start time, Google-Calendar style: "3pm", "10:30am". */
function compactTime(ms: number, locale: string): string {
  const d = new Date(ms);
  const raw = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true });
  // "3:00 PM" → "3pm" ; "10:30 PM" → "10:30pm"
  return raw.replace(':00', '').replace(/\s/g, '').toLowerCase();
}

/**
 * Calendar coloring per shift state — mirrors the jobs-board status
 * color language so the worker reads a consistent scheme:
 *   confirmed → blue (scheduled to work)
 *   accepted  → green (offered, must Confirm/Decline)
 *   submitted → goldenrod (applied, awaiting review)
 *   available → medium grey (other open shift on an engaged job order)
 */
function calendarKindColor(a: WorkerAssignmentItem): string {
  switch (a.calendarKind) {
    case 'confirmed':
      return '#1976d2'; // blue
    case 'accepted':
      return '#2e7d32'; // green
    case 'submitted':
      return '#DAA520'; // goldenrod
    case 'available':
      return '#9e9e9e'; // medium grey — not active, just discoverable
    default:
      if (a.status === 'confirmed') return '#1976d2';
      if (a.status === 'scheduled') return '#2e7d32';
      return '#5f6368'; // neutral (cancelled/completed/etc.)
  }
}

const WorkerAssignmentsCalendar: React.FC<WorkerAssignmentsCalendarProps> = ({ assignments }) => {
  const t = useT();
  const navigate = useNavigate();
  const lang = getLanguage();
  const locale = lang === 'es' ? esLocale : enUS;
  const timeLocale = lang === 'es' ? 'es-US' : 'en-US';

  const [view, setView] = useState<CalendarView>('month');
  // Reference date the view is anchored on (day/week/month all derive from it).
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));

  const byDay = useMemo(() => {
    const map = new Map<string, WorkerAssignmentItem[]>();
    for (const a of assignments) {
      const key = format(new Date(startMs(a)), 'yyyy-MM-dd');
      const list = map.get(key);
      if (list) list.push(a);
      else map.set(key, [a]);
    }
    for (const [, list] of map) {
      list.sort((x, y) => startMs(x) - startMs(y));
    }
    return map;
  }, [assignments]);

  // Grid days for month/week views (day view renders an agenda instead).
  const { rows, weekdayLabels } = useMemo(() => {
    if (view === 'day') return { rows: [] as Date[][], weekdayLabels: [] as string[] };
    const gridStart =
      view === 'week' ? startOfWeek(cursor, { locale }) : startOfWeek(startOfMonth(cursor), { locale });
    const gridEnd =
      view === 'week' ? endOfWeek(cursor, { locale }) : endOfWeek(endOfMonth(cursor), { locale });
    const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const wk = allDays.slice(0, 7).map((d) => format(d, 'EEE', { locale }));
    const r: Date[][] = [];
    for (let i = 0; i < allDays.length; i += 7) r.push(allDays.slice(i, i + 7));
    return { rows: r, weekdayLabels: wk };
  }, [view, cursor, locale]);

  const goPrev = () =>
    setCursor((c) => (view === 'day' ? subDays(c, 1) : view === 'week' ? subWeeks(c, 1) : subMonths(c, 1)));
  const goNext = () =>
    setCursor((c) => (view === 'day' ? addDays(c, 1) : view === 'week' ? addWeeks(c, 1) : addMonths(c, 1)));
  const goToday = () => setCursor(startOfDay(new Date()));

  const headerLabel =
    view === 'day'
      ? format(cursor, 'EEEE, MMMM d, yyyy', { locale })
      : view === 'week'
        ? `${format(startOfWeek(cursor, { locale }), 'MMM d', { locale })} – ${format(
            endOfWeek(cursor, { locale }),
            'MMM d, yyyy',
            { locale },
          )}`
        : format(cursor, 'MMMM yyyy', { locale });

  // Route by calendar kind:
  //   confirmed                        → assignment-details layout
  //   accepted / submitted / available → jobs-board posting (Confirm/
  //                                       Decline, track, or apply)
  // For non-confirmed kinds without a jobPostId, fall back to the
  // jobs-board list (NOT a bogus assignment id like "avail_…").
  const goForItem = (a: WorkerAssignmentItem) => {
    const kind = a.calendarKind ?? (a.status === 'confirmed' ? 'confirmed' : 'accepted');
    if (kind === 'confirmed') {
      navigate(`/c1/workers/assignments/${a.assignmentId}`);
    } else if (a.jobPostId) {
      navigate(`/c1/jobs-board/${a.jobPostId}`);
    } else {
      navigate('/c1/jobs-board');
    }
  };

  /** One clickable shift line (time + title), colored by status. */
  const ItemLine: React.FC<{ a: WorkerAssignmentItem; size?: 'sm' | 'md' }> = ({ a, size = 'sm' }) => {
    const color = calendarKindColor(a);
    const timeLabel = compactTime(startMs(a), timeLocale);
    const variant = size === 'md' ? 'body2' : 'caption';
    // Tooltip: all-caps status word + time + posting/shift + city/state, e.g.
    // "CONFIRMED · 3pm NASCAR - San Diego - Swing Shift Pre Clean • San Diego, CA".
    //   confirmed              → CONFIRMED
    //   accepted / submitted   → PENDING (offered or applied, not yet locked)
    //   available              → AVAILABLE
    const kind = a.calendarKind ?? (a.status === 'confirmed' ? 'confirmed' : undefined);
    const statusWord =
      kind === 'confirmed'
        ? t('assignments.calendarStatusConfirmed')
        : kind === 'accepted' || kind === 'submitted'
          ? t('assignments.calendarStatusPending')
          : kind === 'available'
            ? t('assignments.calendarStatusAvailable')
            : '';
    const fullName = a.postTitle ? `${a.postTitle} - ${a.jobTitle}` : a.jobTitle;
    const tooltip = `${statusWord ? `${statusWord} · ` : ''}${timeLabel} ${fullName}${
      a.cityState ? ` • ${a.cityState}` : ''
    }`;
    return (
      <Box
        onClick={(e) => {
          e.stopPropagation();
          goForItem(a);
        }}
        title={tooltip}
        sx={{
          cursor: 'pointer',
          lineHeight: 1.3,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          ...(size === 'md' && { py: 0.5, borderBottom: 1, borderColor: 'divider' }),
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        <Typography component="span" variant={variant} sx={{ fontWeight: 700, color, mr: 0.5 }}>
          {timeLabel}
        </Typography>
        <Typography component="span" variant={variant} sx={{ color, fontWeight: 500 }}>
          {a.jobTitle}
        </Typography>
      </Box>
    );
  };

  if (assignments.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Typography variant="body1" color="text.secondary">
          {t('assignments.calendarEmpty')}
        </Typography>
      </Paper>
    );
  }

  const dayCellMinHeight = view === 'week' ? 200 : 108;
  const dayItemsForCursor = byDay.get(format(cursor, 'yyyy-MM-dd')) ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          {headerLabel}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <IconButton size="small" aria-label={t('assignments.calendarPrevMonth')} onClick={goPrev}>
              <ChevronLeftIcon />
            </IconButton>
            <Button size="small" startIcon={<TodayIcon />} onClick={goToday}>
              {t('assignments.calendarToday')}
            </Button>
            <IconButton size="small" aria-label={t('assignments.calendarNextMonth')} onClick={goNext}>
              <ChevronRightIcon />
            </IconButton>
          </Stack>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v: CalendarView | null) => {
              if (v) setView(v);
            }}
            aria-label={t('assignments.viewMode')}
          >
            <ToggleButton value="day">{t('assignments.calendarDay')}</ToggleButton>
            <ToggleButton value="week">{t('assignments.calendarWeek')}</ToggleButton>
            <ToggleButton value="month">{t('assignments.calendarMonth')}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Stack>

      {view === 'day' ? (
        // ── Day agenda ──────────────────────────────────────────────
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
          {dayItemsForCursor.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('assignments.calendarNoShiftsDay')}
            </Typography>
          ) : (
            <Stack spacing={0}>
              {dayItemsForCursor.map((a) => (
                <ItemLine key={a.assignmentId} a={a} size="md" />
              ))}
            </Stack>
          )}
        </Paper>
      ) : (
        // ── Month / Week grid ───────────────────────────────────────
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              borderBottom: 1,
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            {weekdayLabels.map((label) => (
              <Box key={label} sx={{ py: 1, px: 0.5, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>

          {rows.map((week, wi) => (
            <Box
              key={wi}
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                borderBottom: wi < rows.length - 1 ? 1 : 0,
                borderColor: 'divider',
              }}
            >
              {week.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayItems = byDay.get(key) ?? [];
                // Week view never dims (all 7 days are "in scope"); month
                // view greys out leading/trailing days from adjacent months.
                const inScope = view === 'week' ? true : isSameMonth(day, cursor);
                const visible = view === 'week' ? dayItems : dayItems.slice(0, MAX_VISIBLE_PER_CELL);
                const extra = dayItems.length - visible.length;

                return (
                  <Box
                    key={key}
                    sx={{
                      minHeight: dayCellMinHeight,
                      borderRight: 1,
                      borderColor: 'divider',
                      p: 0.75,
                      '&:nth-of-type(7n)': { borderRight: 0 },
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mb: 0.5,
                        fontWeight: isToday(day) ? 700 : 500,
                        color: inScope ? 'text.primary' : 'text.disabled',
                        ...(isToday(day) && { color: 'primary.main' }),
                      }}
                    >
                      {format(day, 'd')}
                    </Typography>
                    <Stack spacing={0.25} sx={{ maxHeight: view === 'week' ? 168 : 88, overflowY: 'auto' }}>
                      {visible.map((a) => (
                        <ItemLine key={a.assignmentId} a={a} />
                      ))}
                      {extra > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          +{extra} {t('assignments.calendarMore')}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Paper>
      )}
    </Stack>
  );
};

export default WorkerAssignmentsCalendar;
