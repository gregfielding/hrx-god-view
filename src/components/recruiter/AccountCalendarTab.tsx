/**
 * Account Calendar tab: shifts for job orders associated with this account.
 * For national/parent accounts, includes shifts for all child accounts.
 * Mirrors the layout of /calendar (month view) with account-scoped events only.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  CircularProgress,
  Paper,
  Tooltip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
} from '@mui/icons-material';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, eachDayOfInterval, parseISO, isValid as isValidDate, isSameDay, isSameMonth, isToday, differenceInCalendarDays, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths } from 'date-fns';
import { collection, query, where, getDocs, documentId } from 'firebase/firestore';
import { db } from '../../firebase';
import { p } from '../../data/firestorePaths';
import { useGigJobOrdersCalendar, getColorForJobOrderId } from '../../hooks/useGigJobOrdersCalendar';
import useActiveShifts from '../../hooks/useActiveShifts';
import ShiftsTable from '../shifts/ShiftsTable';
import type { ShiftsJobTypeFilter, ShiftsStatusFilter } from '../../pages/Shifts';
import { SHIFT_STATUS_FILTER_ENTRIES } from '../../utils/shifts/shiftRow';
import type { CalendarEvent, CalendarView } from '../../types/calendar';
import type { RecruiterAccount } from '../../types/recruiter/account';
import { renderShiftTooltip } from '../../utils/calendarShiftTooltip';

function getCalendarRange(view: CalendarView, currentDate: Date): { start: Date; end: Date } {
  if (view === 'day') {
    return { start: startOfDay(currentDate), end: startOfDay(currentDate) };
  }
  if (view === 'week') {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 0 }),
      end: endOfWeek(currentDate, { weekStartsOn: 0 }),
    };
  }
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  return {
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  };
}

function getEventLocalDate(event: CalendarEvent, useStart = true): Date | null {
  const dateTimeStr = useStart
    ? (event.start.dateTime || event.start.date)
    : (event.end.dateTime || event.end.date);
  if (!dateTimeStr) return null;
  if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return new Date(dateTimeStr + 'T00:00:00');
  }
  const parsed = parseISO(dateTimeStr);
  if (!isValidDate(parsed)) return null;
  return parsed;
}

function getEventColor(event: CalendarEvent): { backgroundColor: string; foregroundColor: string } {
  const hex = event.colorId ? getColorForJobOrderId(event.colorId) : '#5c6bc0';
  return { backgroundColor: hex, foregroundColor: '#ffffff' };
}

export interface AccountCalendarTabProps {
  tenantId: string;
  account: RecruiterAccount | null;
  /** When set, only show shifts for job orders at this worksite (calendar filtered downstream). */
  locationFilter?: { companyId: string; locationId: string };
  /** When set (e.g. child account), use these job order ids instead of loading by company scope. */
  scopedJobOrderIds?: string[];
}

const ACCOUNT_SHIFT_TABLE_STATUS: Array<{ value: ShiftsStatusFilter; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  ...SHIFT_STATUS_FILTER_ENTRIES,
];

const ACCOUNT_SHIFT_JOB_TYPE: Array<{ value: ShiftsJobTypeFilter; label: string }> = [
  { value: 'all', label: 'All Types' },
  { value: 'gig', label: 'Gig' },
  { value: 'career', label: 'Career' },
];

const filterSelectSx = {
  height: 36,
  borderRadius: '6px',
  backgroundColor: 'white',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E5E7EB' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#D1D5DB' },
} as const;

const AccountCalendarTab: React.FC<AccountCalendarTabProps> = ({ tenantId, account, locationFilter, scopedJobOrderIds }) => {
  const navigate = useNavigate();
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [accountJobOrderIds, setAccountJobOrderIds] = useState<string[]>([]);
  const [filteredJobOrderIds, setFilteredJobOrderIds] = useState<string[] | null>(null);

  const [shiftTableSearch, setShiftTableSearch] = useState('');
  const [shiftTableStatus, setShiftTableStatus] = useState<ShiftsStatusFilter>('all');
  const [shiftTableJobType, setShiftTableJobType] = useState<ShiftsJobTypeFilter>('all');

  const activeShiftsHookOptions = useMemo(() => {
    if (!account?.id) {
      return { recruiterAccountIds: [] as string[] };
    }
    const ids = new Set<string>([account.id.trim()]);
    (account.childAccountIds ?? []).forEach((id) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    });
    return { recruiterAccountIds: Array.from(ids) };
  }, [account?.id, account?.childAccountIds]);

  const {
    rows: accountShiftRows,
    loading: accountShiftsLoading,
    error: accountShiftsError,
  } = useActiveShifts(tenantId, activeShiftsHookOptions);

  const baseIds = useMemo(() => account?.associations?.jobOrderIds ?? [], [account?.associations?.jobOrderIds]);
  const companyScopeIds = useMemo(() => {
    const ids = new Set<string>();
    if (account?.id) ids.add(account.id);
    (account?.childAccountIds ?? []).forEach((id) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    });
    (account?.associations?.companyIds ?? []).forEach((id) => {
      if (typeof id === 'string' && id.trim()) ids.add(id.trim());
    });
    return Array.from(ids);
  }, [account?.id, (account?.childAccountIds ?? []).join(','), (account?.associations?.companyIds ?? []).join(',')]);

  useEffect(() => {
    if (!tenantId || !account?.id) {
      setAccountJobOrderIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const ids = new Set<string>(baseIds);
      if (companyScopeIds.length > 0) {
        const IN_LIMIT = 10;
        for (let i = 0; i < companyScopeIds.length; i += IN_LIMIT) {
          if (cancelled) return;
          const batch = companyScopeIds.slice(i, i + IN_LIMIT);
          try {
            const ref = collection(db, p.jobOrders(tenantId));
            const q = query(ref, where('companyId', 'in', batch));
            const snap = await getDocs(q);
            snap.docs.forEach((d) => ids.add(d.id));
          } catch {
            // fall back to association IDs only if this query fails
          }
        }
      }
      if (!cancelled) setAccountJobOrderIds(Array.from(ids));
    })();
    return () => { cancelled = true; };
  }, [tenantId, account?.id, baseIds.join(','), companyScopeIds.join(',')]);

  useEffect(() => {
    if (!tenantId || !locationFilter) {
      setFilteredJobOrderIds(null);
      return;
    }
    let cancelled = false;
    const { companyId, locationId } = locationFilter;
    (async () => {
      const matchingIds = new Set<string>();
      try {
        const ref = collection(db, p.jobOrders(tenantId));
        const q = query(ref, where('companyId', '==', companyId));
        const snap = await getDocs(q);
        snap.docs.forEach((d) => {
          const data = d.data() as Record<string, any>;
          const joLocationId = data.locationId ?? data.worksiteId ?? data.deal?.locationId;
          if (joLocationId === locationId) matchingIds.add(d.id);
        });
      } catch {
        // If this query fails, keep filtered set empty instead of leaking cross-account events.
      }
      if (!cancelled) setFilteredJobOrderIds(Array.from(matchingIds));
    })();
    return () => { cancelled = true; };
  }, [tenantId, locationFilter?.companyId, locationFilter?.locationId]);

  const jobOrderIdsForCalendar =
    locationFilter
      ? (filteredJobOrderIds ?? [])
      : (scopedJobOrderIds ?? accountJobOrderIds);

  const dateRange = useMemo(() => getCalendarRange(view, currentDate), [view, currentDate]);

  const { events, loading } = useGigJobOrdersCalendar({
    tenantId,
    timeMin: dateRange.start,
    timeMax: dateRange.end,
    enabled: !!tenantId,
    jobOrderIds: jobOrderIdsForCalendar,
  });

  const goToToday = () => {
    setCurrentDate(new Date());
    setView('day');
  };
  const goToPrevious = () => {
    if (view === 'day') setCurrentDate((prev) => subDays(prev, 1));
    else if (view === 'week') setCurrentDate((prev) => subWeeks(prev, 1));
    else setCurrentDate((prev) => subMonths(prev, 1));
  };
  const goToNext = () => {
    if (view === 'day') setCurrentDate((prev) => addDays(prev, 1));
    else if (view === 'week') setCurrentDate((prev) => addWeeks(prev, 1));
    else setCurrentDate((prev) => addMonths(prev, 1));
  };

  const openEvent = useCallback(
    (event: CalendarEvent) => {
      if (event.calendarId === 'gig-job-orders' && event.colorId) {
        navigate(`/jobs/job-orders/${event.colorId}`);
      }
    },
    [navigate]
  );

  const getEventsForDay = useCallback(
    (day: Date): CalendarEvent[] => {
      return events.filter((event) => {
        const startDate = getEventLocalDate(event, true);
        if (!startDate) return false;
        return isSameDay(startDate, day);
      });
    },
    [events]
  );

  if (!account) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Shifts for job orders linked to this account.
        {account.childAccountIds?.length ? ' Includes all child accounts.' : ''}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Button size="small" startIcon={<TodayIcon />} onClick={goToToday} variant="outlined">
          Today
        </Button>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Button size="small" onClick={goToPrevious} sx={{ minWidth: 36 }}>
            <ChevronLeftIcon />
          </Button>
          <Typography variant="subtitle1" sx={{ minWidth: 160, textAlign: 'center' }}>
            {view === 'month' ? format(currentDate, 'MMMM yyyy') : view === 'week' ? `Week of ${format(currentDate, 'MMM d, yyyy')}` : format(currentDate, 'EEEE, MMM d, yyyy')}
          </Typography>
          <Button size="small" onClick={goToNext} sx={{ minWidth: 36 }}>
            <ChevronRightIcon />
          </Button>
        </Box>
        <ToggleButtonGroup
          size="small"
          value={view}
          exclusive
          onChange={(_, v) => v && setView(v)}
          sx={{ ml: 1 }}
        >
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : view === 'month' ? (
        <Paper variant="outlined" sx={{ overflow: 'hidden', flex: 1 }}>
          <MonthView
            currentDate={currentDate}
            events={events}
            getEventsForDay={getEventsForDay}
            getEventLocalDate={getEventLocalDate}
            getEventColor={getEventColor}
            onEventClick={openEvent}
          />
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Week and day views: switch to Month or open the full calendar for detailed views.
        </Typography>
      )}

      <Divider sx={{ my: 3 }} />

      <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
        Shift list
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
        Same shifts table as Shifts → List, scoped to job orders for this account
        {account.childAccountIds?.length ? ' (includes child accounts).' : '.'}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
        <TextField
          size="small"
          placeholder="Search shifts…"
          value={shiftTableSearch}
          onChange={(e) => setShiftTableSearch(e.target.value)}
          sx={{ minWidth: 200, flex: '1 1 200px', maxWidth: 420 }}
          InputProps={{ sx: { borderRadius: '6px', bgcolor: 'white' } }}
        />
        <FormControl size="small" sx={{ minWidth: 150, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Status</InputLabel>
          <Select
            value={shiftTableStatus}
            label="Status"
            onChange={(e) => setShiftTableStatus(e.target.value as ShiftsStatusFilter)}
            sx={filterSelectSx}
          >
            {ACCOUNT_SHIFT_TABLE_STATUS.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140, height: 36 }}>
          <InputLabel sx={{ fontSize: '0.875rem' }}>Job type</InputLabel>
          <Select
            value={shiftTableJobType}
            label="Job type"
            onChange={(e) => setShiftTableJobType(e.target.value as ShiftsJobTypeFilter)}
            sx={filterSelectSx}
          >
            {ACCOUNT_SHIFT_JOB_TYPE.map((opt) => (
              <MenuItem key={opt.value} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <ShiftsTable
        tenantId={tenantId}
        rows={accountShiftRows}
        loading={accountShiftsLoading}
        error={accountShiftsError}
        search={shiftTableSearch}
        showFavoritesOnly={false}
        accountFilter="all"
        statusFilter={shiftTableStatus}
        jobTypeFilter={shiftTableJobType}
        accountFilterDisabled
        containerSx={{ px: 0, pt: 0 }}
        emptyStateNoDataMessage="No shifts for job orders linked to this account."
      />
    </Box>
  );
};

function MonthView({
  currentDate,
  events,
  getEventsForDay,
  getEventLocalDate,
  getEventColor,
  onEventClick,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  getEventsForDay: (day: Date) => CalendarEvent[];
  getEventLocalDate: (e: CalendarEvent, useStart: boolean) => Date | null;
  getEventColor: (e: CalendarEvent) => { backgroundColor: string; foregroundColor: string };
  onEventClick: (e: CalendarEvent) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventSpanDays = (event: CalendarEvent): { startDay: Date; endDay: Date } | null => {
    const start = getEventLocalDate(event, true);
    if (!start) return null;
    const end = getEventLocalDate(event, false) || start;
    const endInclusive = end.getTime() > start.getTime() ? new Date(end.getTime() - 1) : start;
    return { startDay: startOfDay(start), endDay: startOfDay(endInclusive) };
  };
  const isMultiDayEvent = (event: CalendarEvent): boolean => {
    const span = getEventSpanDays(event);
    if (!span) return false;
    return !isSameDay(span.startDay, span.endDay);
  };
  const multiDayEvents = events.filter(isMultiDayEvent);
  const multiDayEventIds = new Set(multiDayEvents.map((e) => e.id));
  const gigMultiDayShiftIds = new Set(
    multiDayEvents
      .filter((e) => e.calendarId === 'gig-job-orders' && e.hrx?.gigShiftRange && e.hrx?.gigShiftId)
      .map((e) => e.hrx!.gigShiftId as string)
  );

  const weeks: Date[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  const dayHeaderHeight = 22;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <Box
            key={day}
            sx={{
              p: 1.5,
              textAlign: 'center',
              fontWeight: 600,
              fontSize: '0.875rem',
              color: 'text.secondary',
              bgcolor: 'grey.50',
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            {day}
          </Box>
        ))}
      </Box>
      {weeks.map((weekDays, weekIndex) => {
        const weekStart = weekDays[0];
        const weekEnd = weekDays[6];
        type Segment = { event: CalendarEvent; startIdx: number; endIdx: number; row: number };
        const rawSegments: Omit<Segment, 'row'>[] = [];
        for (const event of multiDayEvents) {
          const span = getEventSpanDays(event);
          if (!span || span.endDay < weekStart || span.startDay > weekEnd) continue;
          const segStartDay = span.startDay < weekStart ? weekStart : span.startDay;
          const segEndDay = span.endDay > weekEnd ? weekEnd : span.endDay;
          const startIdx = Math.max(0, Math.min(6, differenceInCalendarDays(segStartDay, weekStart)));
          const endIdx = Math.max(0, Math.min(6, differenceInCalendarDays(segEndDay, weekStart)));
          rawSegments.push({ event, startIdx, endIdx });
        }
        rawSegments.sort((a, b) => (a.startIdx - b.startIdx) || (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx));
        const rowEnds: number[] = [];
        const segments: Segment[] = [];
        for (const seg of rawSegments) {
          let row = 0;
          while (row < rowEnds.length && rowEnds[row] >= seg.startIdx) row++;
          if (row === rowEnds.length) rowEnds.push(seg.endIdx);
          else rowEnds[row] = seg.endIdx;
          segments.push({ ...seg, row });
        }
        const barHeight = 18;
        const barGap = 4;
        const barsTop = dayHeaderHeight + 4;
        const stripHeight = rowEnds.length > 0 ? rowEnds.length * barHeight + Math.max(0, rowEnds.length - 1) * barGap + 8 : 0;

        return (
          <Box
            key={`week-${weekIndex}`}
            sx={{
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              borderBottom: weekIndex === weeks.length - 1 ? 'none' : '1px solid',
              borderColor: 'divider',
            }}
          >
            {segments.length > 0 && (
              <Box
                sx={{
                  position: 'absolute',
                  top: barsTop,
                  left: 0,
                  right: 0,
                  px: 1,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  gridAutoRows: `${barHeight}px`,
                  rowGap: barGap,
                  zIndex: 2,
                }}
              >
                {segments.map((seg) => {
                  const eventColor = getEventColor(seg.event);
                  const tooltipContent = renderShiftTooltip(seg.event);
                  const bar = (
                    <Box
                      key={`${seg.event.id}-${seg.startIdx}-${seg.row}`}
                      onClick={(e) => { e.stopPropagation(); onEventClick(seg.event); }}
                      sx={{
                        gridColumn: `${seg.startIdx + 1} / ${seg.endIdx + 2}`,
                        gridRow: seg.row + 1,
                        mx: 0.5,
                        px: 1,
                        display: 'flex',
                        alignItems: 'center',
                        bgcolor: eventColor.backgroundColor,
                        // Always white so the shift name is legible across all bar colors.
                        color: '#ffffff',
                        borderRadius: 0.5,
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        '&:hover': { opacity: 0.9 },
                      }}
                    >
                      {seg.event.summary}
                    </Box>
                  );
                  if (!tooltipContent) return bar;
                  return (
                    <Tooltip
                      key={`${seg.event.id}-${seg.startIdx}-${seg.row}`}
                      title={tooltipContent}
                      arrow
                      placement="top"
                      enterDelay={150}
                    >
                      {bar}
                    </Tooltip>
                  );
                })}
              </Box>
            )}
            {weekDays.map((day) => {
              const isCurrentMonth = isSameMonth(day, currentDate);
              const isTodayDate = isToday(day);
              const allEventsForDay = getEventsForDay(day);
              const dayEvents = allEventsForDay
                .filter((e) => !multiDayEventIds.has(e.id))
                .filter((e) => {
                  if (e.calendarId !== 'gig-job-orders') return true;
                  const gigShiftId = e.hrx?.gigShiftId;
                  if (!gigShiftId) return true;
                  if (e.hrx?.gigShiftRange) return true;
                  return !gigMultiDayShiftIds.has(gigShiftId);
                });
              return (
                <Box
                  key={day.toISOString()}
                  sx={{
                    minHeight: 120,
                    p: 1,
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isCurrentMonth ? 'background.paper' : 'grey.50',
                    position: 'relative',
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      height: dayHeaderHeight,
                      lineHeight: `${dayHeaderHeight}px`,
                      fontWeight: isTodayDate ? 700 : 400,
                      color: isTodayDate ? 'primary.main' : isCurrentMonth ? 'text.primary' : 'text.disabled',
                    }}
                  >
                    {format(day, 'd')}
                  </Typography>
                  {stripHeight > 0 && <Box sx={{ height: stripHeight }} />}
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                    {dayEvents.slice(0, 3).map((event) => {
                      const eventColor = getEventColor(event);
                      const tooltipContent = renderShiftTooltip(event);
                      const chip = (
                        <Box
                          key={event.id}
                          onClick={(e) => { e.stopPropagation(); onEventClick(event); }}
                          sx={{
                            px: 1,
                            py: 0.5,
                            bgcolor: eventColor.backgroundColor,
                            // Always white so the shift name is legible across all chip colors.
                            color: '#ffffff',
                            borderRadius: 0.5,
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            cursor: 'pointer',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            '&:hover': { opacity: 0.9 },
                          }}
                        >
                          {event.summary}
                        </Box>
                      );
                      if (!tooltipContent) return chip;
                      return (
                        <Tooltip
                          key={event.id}
                          title={tooltipContent}
                          arrow
                          placement="top"
                          enterDelay={150}
                        >
                          {chip}
                        </Tooltip>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                        +{dayEvents.length - 3} more
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

export default AccountCalendarTab;
