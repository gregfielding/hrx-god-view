/**
 * Month calendar for worker assignments (upcoming + past combined).
 * Click a shift to open assignment detail.
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
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

  const goDetail = (id: string) => {
    navigate(`/c1/workers/assignments/${id}`);
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
                  <Stack spacing={0.35} sx={{ maxHeight: 88, overflowY: 'auto' }}>
                    {visible.map((a) => (
                      <Chip
                        key={a.assignmentId}
                        size="small"
                        label={a.jobTitle}
                        onClick={() => goDetail(a.assignmentId)}
                        sx={{
                          height: 'auto',
                          py: 0.25,
                          '& .MuiChip-label': {
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          },
                        }}
                      />
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
    </Stack>
  );
};

export default WorkerAssignmentsCalendar;
