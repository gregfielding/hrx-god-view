/**
 * ShiftsCalendar — month-grid view tab body for /shifts.
 *
 * Reads the same `rows` dataset that ShiftsList consumes (provided via
 * outlet context by `Shifts.tsx`), buckets each shift onto the day(s) it
 * occupies, and paints a simple 7-col month grid.
 *
 * Bucketing rules (mirroring List's filter):
 *   - Single shift  → painted on shiftDate.
 *   - Multi-day gig → painted on every day in [shiftDate..endDate]
 *                     that's ≥ today.
 *   - Career multi  → ongoing recurring; shown in the "Recurring shifts"
 *                     banner above the grid (not painted per-day, since
 *                     they have no end date and would saturate every cell).
 *
 * Click a shift chip → opens the same ShiftPlacementsDrawer the List uses.
 *
 * v1 deliberately uses MUI primitives only (no calendar dep). If we need
 * week/day views or drag-drop later, swap in a library at that point.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Loop as LoopIcon,
} from '@mui/icons-material';
import { useOutletContext } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import ShiftPlacementsDrawer from '../components/shifts/ShiftPlacementsDrawer';
import { useFavorites } from '../hooks/useFavorites';
import {
  parseYyyyMmDdLocal,
  todayIsoLocal,
  type ShiftRow,
} from '../utils/shifts/shiftRow';
import type { ShiftsOutletContext } from './Shifts';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* -------------------------------------------------------------------------
 * Pure helpers — kept inline so the calendar stays self-contained.
 * ------------------------------------------------------------------------- */

function isoFromYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function startOfMonth(y: number, m: number): Date {
  return new Date(y, m - 1, 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * Build the 6×7 grid of ISO date strings for a given month. Cells before
 * day 1 are filled from the prior month; trailing cells extend into the
 * next month so the grid is always rectangular.
 */
function buildMonthGrid(year: number, month1: number): string[] {
  const first = startOfMonth(year, month1);
  const startWeekday = first.getDay(); // 0=Sun..6=Sat
  const dim = daysInMonth(year, month1);
  const cells: string[] = [];

  // Leading days from previous month.
  if (startWeekday > 0) {
    const prevMonthDim = daysInMonth(
      month1 === 1 ? year - 1 : year,
      month1 === 1 ? 12 : month1 - 1,
    );
    const prevYear = month1 === 1 ? year - 1 : year;
    const prevMonth = month1 === 1 ? 12 : month1 - 1;
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push(isoFromYmd(prevYear, prevMonth, prevMonthDim - i));
    }
  }

  for (let d = 1; d <= dim; d++) cells.push(isoFromYmd(year, month1, d));

  // Trailing days to fill final row(s) up to 42 cells (6 weeks).
  const nextYear = month1 === 12 ? year + 1 : year;
  const nextMonth = month1 === 12 ? 1 : month1 + 1;
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push(isoFromYmd(nextYear, nextMonth, nextDay++));
  }
  return cells;
}

/**
 * Bucket each row onto every day it occupies. Career-recurring rows
 * (sortKey === Infinity) are excluded — they go in the recurring banner.
 */
function bucketRowsByDay(rows: ShiftRow[]): {
  byDay: Map<string, ShiftRow[]>;
  recurring: ShiftRow[];
} {
  const byDay = new Map<string, ShiftRow[]>();
  const recurring: ShiftRow[] = [];

  for (const row of rows) {
    if (!Number.isFinite(row.sortKey)) {
      recurring.push(row);
      continue;
    }
    const start = row.shift.shiftDate;
    const end = row.shift.endDate || start;
    if (!start) continue;
    const startD = parseYyyyMmDdLocal(start);
    const endD = parseYyyyMmDdLocal(end);
    if (!startD || !endD) continue;

    // Walk day-by-day inclusive. Cap to a reasonable horizon (90 days)
    // so a runaway endDate in dirty data can't stall the render.
    const cur = new Date(startD);
    let safety = 0;
    while (cur.getTime() <= endD.getTime() && safety++ < 90) {
      const iso = isoFromYmd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
      const list = byDay.get(iso);
      if (list) list.push(row);
      else byDay.set(iso, [row]);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return { byDay, recurring };
}

const MAX_VISIBLE_PER_DAY = 3;

const ShiftsCalendar: React.FC = () => {
  const { tenantId } = useAuth();
  const ctx = useOutletContext<ShiftsOutletContext | null>();
  const search = (ctx?.search ?? '').trim().toLowerCase();
  const showFavoritesOnly = ctx?.showFavoritesOnly ?? false;
  const accountFilter = ctx?.accountFilter ?? 'all';
  const statusFilter = ctx?.statusFilter ?? 'all';
  const jobTypeFilter = ctx?.jobTypeFilter ?? 'all';
  const allRows = ctx?.rows ?? [];
  const loading = ctx?.loading ?? false;
  const error = ctx?.error ?? null;

  const { isFavorite } = useFavorites('shifts');

  // Apply the same client-side search + favorites + account + status filter
  // as the List view, so the two tabs stay coherent when the user toggles
  // anything in the page-level toolbar.
  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (showFavoritesOnly && !isFavorite(`${r.jobOrder.id}:${r.shift.id}`)) {
        return false;
      }
      if (accountFilter !== 'all' && r.jobOrder.companyName !== accountFilter) {
        return false;
      }
      if (statusFilter !== 'all' && (r.shift.status ?? 'open') !== statusFilter) {
        return false;
      }
      if (jobTypeFilter !== 'all' && r.jobOrder.jobType !== jobTypeFilter) {
        return false;
      }
      if (!search) return true;
      const haystack = [
        r.shift.shiftTitle,
        r.shift.defaultJobTitle,
        r.jobOrder.jobTitle,
        r.jobOrder.jobOrderNumber,
        r.jobOrder.companyName,
        r.jobOrder.worksiteName,
        r.jobOrder.worksiteAddress?.city,
        r.jobOrder.worksiteAddress?.state,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [
    allRows,
    search,
    showFavoritesOnly,
    accountFilter,
    statusFilter,
    jobTypeFilter,
    isFavorite,
  ]);

  // Cursor month — defaults to today. Stored as {year, month1} so we don't
  // mutate Date objects in state.
  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, iso: todayIsoLocal() };
  }, []);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: today.y, m: today.m });

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);
  const { byDay, recurring } = useMemo(() => bucketRowsByDay(rows), [rows]);

  const monthLabel = useMemo(() => {
    return new Date(cursor.y, cursor.m - 1, 1).toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }, [cursor]);

  const goPrev = () => {
    setCursor((c) => (c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 }));
  };
  const goNext = () => {
    setCursor((c) => (c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 }));
  };
  const goToday = () => setCursor({ y: today.y, m: today.m });

  const [openRow, setOpenRow] = useState<ShiftRow | null>(null);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Month navigation header */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton size="small" onClick={goPrev} aria-label="Previous month">
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Typography variant="h6" sx={{ minWidth: 180, fontWeight: 600 }}>
            {monthLabel}
          </Typography>
          <IconButton size="small" onClick={goNext} aria-label="Next month">
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Button
          size="small"
          variant="outlined"
          onClick={goToday}
          disabled={cursor.y === today.y && cursor.m === today.m}
          sx={{ textTransform: 'none', borderRadius: 999 }}
        >
          Today
        </Button>
      </Stack>

      {/* Recurring (career multi-day) shifts banner. Always-on shifts that
          don't sit on a specific date — surface them once instead of
          painting every cell. */}
      {recurring.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            mb: 1.5,
            p: 1.25,
            borderRadius: 2,
            bgcolor: 'rgba(0, 87, 184, 0.04)',
            borderColor: 'rgba(0, 87, 184, 0.2)',
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
            <LoopIcon fontSize="small" sx={{ color: '#0057B8' }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Recurring shifts ({recurring.length})
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {recurring.map((row) => (
              <Tooltip
                key={`${row.jobOrder.id}:${row.shift.id}`}
                title={`${row.jobOrder.companyName ?? ''} · ${row.timeLabel}`}
                arrow
              >
                <Chip
                  size="small"
                  label={
                    row.shift.shiftTitle ||
                    row.shift.defaultJobTitle ||
                    row.jobOrder.jobTitle ||
                    'Shift'
                  }
                  onClick={() => setOpenRow(row)}
                  sx={{ cursor: 'pointer' }}
                />
              </Tooltip>
            ))}
          </Stack>
        </Paper>
      )}

      {/* Month grid */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {/* Weekday header row */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            bgcolor: 'rgba(0, 0, 0, 0.03)',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          {DAY_LABELS.map((d) => (
            <Box
              key={d}
              sx={{
                px: 1,
                py: 0.75,
                textAlign: 'center',
                fontSize: 12,
                fontWeight: 600,
                color: 'text.secondary',
              }}
            >
              {d}
            </Box>
          ))}
        </Box>

        {/* 6 rows × 7 cols. Each cell is a fixed min-height so multi-event
            cells don't push neighbors around. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {grid.map((iso, idx) => {
            const dt = parseYyyyMmDdLocal(iso);
            const day = dt ? dt.getDate() : 0;
            const inMonth = dt
              ? dt.getFullYear() === cursor.y && dt.getMonth() + 1 === cursor.m
              : false;
            const isToday = iso === today.iso;
            const dayRows = byDay.get(iso) ?? [];
            const visible = dayRows.slice(0, MAX_VISIBLE_PER_DAY);
            const overflow = Math.max(0, dayRows.length - visible.length);
            const isLastInRow = (idx + 1) % 7 === 0;
            const isLastRow = idx >= 35;

            return (
              <Box
                key={iso + ':' + idx}
                sx={{
                  position: 'relative',
                  minHeight: 110,
                  p: 0.75,
                  borderRight: isLastInRow ? 'none' : '1px solid',
                  borderBottom: isLastRow ? 'none' : '1px solid',
                  borderColor: 'divider',
                  bgcolor: inMonth ? 'background.paper' : 'rgba(0, 0, 0, 0.02)',
                  opacity: inMonth ? 1 : 0.55,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.4,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Box
                    sx={{
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 500,
                      color: isToday ? 'white' : inMonth ? 'text.primary' : 'text.secondary',
                      bgcolor: isToday ? '#0057B8' : 'transparent',
                      borderRadius: '999px',
                      width: isToday ? 22 : 'auto',
                      height: isToday ? 22 : 'auto',
                      minWidth: 22,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      lineHeight: 1,
                    }}
                  >
                    {day}
                  </Box>
                </Box>

                {visible.map((row) => {
                  const label =
                    row.shift.shiftTitle ||
                    row.shift.defaultJobTitle ||
                    row.jobOrder.jobTitle ||
                    'Shift';
                  const subtitle = row.timeLabel === '— – —' ? '' : row.timeLabel;
                  return (
                    <Tooltip
                      key={`${row.jobOrder.id}:${row.shift.id}`}
                      title={
                        <>
                          <div>
                            <strong>{label}</strong>
                          </div>
                          {row.jobOrder.companyName && <div>{row.jobOrder.companyName}</div>}
                          {subtitle && <div>{subtitle}</div>}
                        </>
                      }
                      arrow
                      placement="top"
                    >
                      <Box
                        onClick={() => setOpenRow(row)}
                        sx={{
                          fontSize: 11,
                          lineHeight: 1.25,
                          px: 0.6,
                          py: 0.3,
                          borderRadius: 0.75,
                          cursor: 'pointer',
                          color: 'white',
                          bgcolor:
                            row.shift.status === 'filled'
                              ? '#1976d2'
                              : row.shift.status === 'open'
                              ? '#2e7d32'
                              : '#5c6bc0',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          '&:hover': { filter: 'brightness(1.1)' },
                        }}
                      >
                        {label}
                      </Box>
                    </Tooltip>
                  );
                })}

                {overflow > 0 && (
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', fontSize: 11, pl: 0.5 }}
                  >
                    +{overflow} more
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </Paper>

      <ShiftPlacementsDrawer
        open={openRow !== null}
        tenantId={tenantId ?? null}
        jobOrderId={openRow?.jobOrder.id ?? null}
        shift={
          openRow
            ? {
                id: openRow.shift.id,
                shiftTitle: openRow.shift.shiftTitle,
                dateLabel: openRow.dateLabel,
                timeLabel: openRow.timeLabel,
              }
            : null
        }
        onClose={() => setOpenRow(null)}
      />
    </Box>
  );
};

export default ShiftsCalendar;
