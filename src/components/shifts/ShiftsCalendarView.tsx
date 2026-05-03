/**
 * ShiftsCalendarView — reusable month calendar for active shifts.
 *
 * Used by `/shifts/calendar` and embeddable anywhere we pass pre-filtered
 * `ShiftRow[]` (same dataset shape as `ShiftsTable`).
 *
 * Career recurring rows (`sortKey === Infinity`) paint on **today's** cell so
 * they stay visible without the legacy recurring banner.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
} from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';

import ShiftPlacementsDrawer from './ShiftPlacementsDrawer';
import {
  parseYyyyMmDdLocal,
  todayIsoLocal,
  toShiftPlacementsDrawerSummary,
  type ShiftRow,
} from '../../utils/shifts/shiftRow';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoFromYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function startOfMonth(y: number, m: number): Date {
  return new Date(y, m - 1, 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function buildMonthGrid(year: number, month1: number): string[] {
  const first = startOfMonth(year, month1);
  const startWeekday = first.getDay();
  const dim = daysInMonth(year, month1);
  const cells: string[] = [];

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
 * (`sortKey` not finite) are placed on **today** so they remain visible
 * without a separate banner.
 */
function bucketRowsByDay(rows: ShiftRow[]): Map<string, ShiftRow[]> {
  const byDay = new Map<string, ShiftRow[]>();
  const todayIso = todayIsoLocal();

  for (const row of rows) {
    if (!Number.isFinite(row.sortKey)) {
      const list = byDay.get(todayIso);
      if (list) list.push(row);
      else byDay.set(todayIso, [row]);
      continue;
    }
    const start = row.shift.shiftDate;
    const end = row.shift.endDate || start;
    if (!start) continue;
    const startD = parseYyyyMmDdLocal(start);
    const endD = parseYyyyMmDdLocal(end);
    if (!startD || !endD) continue;

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
  return byDay;
}

const MAX_VISIBLE_PER_DAY = 3;

export interface ShiftsCalendarViewProps {
  tenantId: string | null | undefined;
  /** Pre-filtered rows (search, account, status, etc.). */
  rows: ShiftRow[];
  loading: boolean;
  error: string | null;
  containerSx?: SxProps<Theme>;
}

const ShiftsCalendarView: React.FC<ShiftsCalendarViewProps> = ({
  tenantId,
  rows,
  loading,
  error,
  containerSx,
}) => {
  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, iso: todayIsoLocal() };
  }, []);
  const [cursor, setCursor] = useState<{ y: number; m: number }>({ y: today.y, m: today.m });

  const grid = useMemo(() => buildMonthGrid(cursor.y, cursor.m), [cursor]);
  const byDay = useMemo(() => bucketRowsByDay(rows), [rows]);

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
    <Box
      sx={[
        { px: 2, pt: 1.5 },
        ...(containerSx != null ? [containerSx] : []),
      ] as SxProps<Theme>}
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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

      {/* Recurring shifts card removed (was "Recurring shifts (N)" above grid).
          Career recurring (`sortKey` non-finite) rows paint on today's cell — see `bucketRowsByDay`. */}

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
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

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {grid.map((iso, idx) => {
            const dt = parseYyyyMmDdLocal(iso);
            const day = dt ? dt.getDate() : 0;
            const inMonth = dt
              ? dt.getFullYear() === cursor.y && dt.getMonth() + 1 === cursor.m
              : false;
            const isTodayCell = iso === today.iso;
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
                      fontWeight: isTodayCell ? 700 : 500,
                      color: isTodayCell ? 'white' : inMonth ? 'text.primary' : 'text.secondary',
                      bgcolor: isTodayCell ? '#0057B8' : 'transparent',
                      borderRadius: '999px',
                      width: isTodayCell ? 22 : 'auto',
                      height: isTodayCell ? 22 : 'auto',
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
        shift={openRow ? toShiftPlacementsDrawerSummary(openRow) : null}
        onClose={() => setOpenRow(null)}
      />
    </Box>
  );
};

export default ShiftsCalendarView;
