/**
 * Month calendar for worker assignments (upcoming + past combined).
 * Click a shift to open assignment detail.
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import { useNavigate } from 'react-router-dom';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { enUS, es as esLocale } from 'date-fns/locale';
import { useT, getLanguage } from '../../../i18n';
import type { WorkerAssignmentItem } from './WorkerAssignmentCard';

export interface WorkerAssignmentsCalendarProps {
  assignments: WorkerAssignmentItem[];
}

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

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));

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

  const { rows, weekdayLabels } = useMemo(() => {
    const ms = startOfMonth(viewMonth);
    const me = endOfMonth(viewMonth);
    const gridStart = startOfWeek(ms, { locale });
    const gridEnd = endOfWeek(me, { locale });
    const allDays = eachDayOfInterval({ start: gridStart, end: gridEnd });
    const wk = allDays.slice(0, 7).map((d) => format(d, 'EEE', { locale }));
    const r: Date[][] = [];
    for (let i = 0; i < allDays.length; i += 7) {
      r.push(allDays.slice(i, i + 7));
    }
    return { rows: r, weekdayLabels: wk };
  }, [viewMonth, locale]);

  // Route by calendar kind:
  //   confirmed                       → assignment-details layout
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

  if (assignments.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Typography variant="body1" color="text.secondary">
          {t('assignments.calendarEmpty')}
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          {format(viewMonth, 'MMMM yyyy', { locale })}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <IconButton
            size="small"
            aria-label={t('assignments.calendarPrevMonth')}
            onClick={() => setViewMonth((d) => subMonths(d, 1))}
          >
            <ChevronLeftIcon />
          </IconButton>
          <Button
            size="small"
            startIcon={<TodayIcon />}
            onClick={() => setViewMonth(startOfMonth(new Date()))}
          >
            {t('assignments.calendarToday')}
          </Button>
          <IconButton
            size="small"
            aria-label={t('assignments.calendarNextMonth')}
            onClick={() => setViewMonth((d) => addMonths(d, 1))}
          >
            <ChevronRightIcon />
          </IconButton>
        </Stack>
      </Stack>

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
              const inMonth = isSameMonth(day, viewMonth);
              const visible = dayItems.slice(0, MAX_VISIBLE_PER_CELL);
              const extra = dayItems.length - visible.length;

              return (
                <Box
                  key={key}
                  sx={{
                    minHeight: 108,
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
                      color: inMonth ? 'text.primary' : 'text.disabled',
                      ...(isToday(day) && {
                        color: 'primary.main',
                      }),
                    }}
                  >
                    {format(day, 'd')}
                  </Typography>
                  <Stack spacing={0.25} sx={{ maxHeight: 88, overflowY: 'auto' }}>
                    {visible.map((a) => {
                      const color = calendarKindColor(a);
                      const timeLabel = compactTime(startMs(a), lang === 'es' ? 'es-US' : 'en-US');
                      return (
                        // Google-Calendar-style row: compact start time +
                        // title, colored by status, clickable. No chip
                        // background — reads as a clean agenda line.
                        <Box
                          key={a.assignmentId}
                          onClick={(e) => {
                            e.stopPropagation();
                            goForItem(a);
                          }}
                          title={`${timeLabel} ${a.jobTitle}`}
                          sx={{
                            cursor: 'pointer',
                            lineHeight: 1.25,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                            '&:hover': { textDecoration: 'underline' },
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ fontWeight: 700, color, mr: 0.5 }}
                          >
                            {timeLabel}
                          </Typography>
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{ color, fontWeight: 500 }}
                          >
                            {a.jobTitle}
                          </Typography>
                        </Box>
                      );
                    })}
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
    </Stack>
  );
};

export default WorkerAssignmentsCalendar;
