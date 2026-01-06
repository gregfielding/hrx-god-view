/**
 * Calendar Page
 * 
 * Full-screen calendar page with Month/Week/Day views, sidebar, and event management.
 * Phase 2 implementation per calendar-phase2-calendar-page-and-feed.md
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Drawer,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ToggleButton,
  ToggleButtonGroup,
  useMediaQuery,
  useTheme,
  Paper,
  Divider,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Add as AddIcon,
  Menu as MenuIcon,
  Event as EventIcon,
} from '@mui/icons-material';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, isSameDay, isSameMonth, isToday, eachDayOfInterval, parseISO, isValid as isValidDate } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { useCalendarList } from '../hooks/useCalendarList';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import EventModal from '../components/calendar/EventModal';
import type { CalendarEvent, CalendarView } from '../types/calendar';

/**
 * Calculate date range for calendar view
 */
function getCalendarRange(view: CalendarView, currentDate: Date): { start: Date; end: Date } {
  if (view === 'day') {
    return {
      start: startOfDay(currentDate),
      end: endOfDay(currentDate),
    };
  }
  
  if (view === 'week') {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: 0 }), // Sunday
      end: endOfWeek(currentDate, { weekStartsOn: 0 }),
    };
  }
  
  // Month view: start of week containing the 1st, end of week containing the last day
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  return {
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  };
}

const CalendarPage: React.FC = () => {
  const { user, activeTenant } = useAuth();
  const userId = user?.uid || '';
  const tenantId = activeTenant?.id || '';
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg')); // < 1024px
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [searchParams, setSearchParams] = useSearchParams();

  // View state
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  
  // Deep-link handling: highlighted event ID and refs for scrolling
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Calendar list and selection
  const { calendars, loading: calendarsLoading } = useCalendarList({ userId, enabled: !!userId });
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set(['primary']));

  // Event modal state
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalMode, setEventModalMode] = useState<'create' | 'edit'>('create');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createEventDate, setCreateEventDate] = useState<Date | undefined>(undefined);

  // Calculate date range for current view
  const dateRange = useMemo(() => getCalendarRange(view, currentDate), [view, currentDate]);

  // Fetch events for selected calendars and date range
  const { events, loading: eventsLoading, refetch: refetchEvents } = useCalendarEvents({
    userId,
    calendarIds: Array.from(selectedCalendarIds),
    timeMin: dateRange.start,
    timeMax: dateRange.end,
    enabled: selectedCalendarIds.size > 0 && !!userId,
  });

  // Initialize selected calendars when list loads
  useEffect(() => {
    if (calendars.length > 0 && selectedCalendarIds.size === 0) {
      const primary = calendars.find((c) => c.isPrimary) || calendars[0];
      if (primary) {
        setSelectedCalendarIds(new Set([primary.id]));
      }
    }
  }, [calendars, selectedCalendarIds.size]);

  // Toggle calendar visibility
  const toggleCalendar = useCallback((calendarId: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  }, []);

  // Navigation
  const goToToday = () => {
    setCurrentDate(new Date());
    setView('day'); // Always snap to day view for "Today"
  };

  const goToPrevious = () => {
    if (view === 'day') {
      setCurrentDate((prev) => subDays(prev, 1));
    } else if (view === 'week') {
      setCurrentDate((prev) => subWeeks(prev, 1));
    } else {
      setCurrentDate((prev) => subMonths(prev, 1));
    }
  };

  const goToNext = () => {
    if (view === 'day') {
      setCurrentDate((prev) => addDays(prev, 1));
    } else if (view === 'week') {
      setCurrentDate((prev) => addWeeks(prev, 1));
    } else {
      setCurrentDate((prev) => addMonths(prev, 1));
    }
  };

  // Event modal handlers
  const openCreateModal = (date?: Date) => {
    setCreateEventDate(date || currentDate);
    setSelectedEvent(null);
    setEventModalMode('create');
    setEventModalOpen(true);
  };

  const openEditModal = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setEventModalMode('edit');
    setEventModalOpen(true);
  };

  const handleEventSaved = () => {
    setEventModalOpen(false);
    refetchEvents();
  };

  // Get upcoming events for sidebar (next 5-10 events)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter((event) => {
        const startStr = event.start.dateTime || event.start.date;
        if (!startStr) return false;
        const startDate = parseISO(startStr);
        return startDate >= now;
      })
      .sort((a, b) => {
        const aStart = parseISO(a.start.dateTime || a.start.date || '');
        const bStart = parseISO(b.start.dateTime || b.start.date || '');
        return aStart.getTime() - bStart.getTime();
      })
      .slice(0, 10);
  }, [events]);

  // Deep-link handling: process query params
  useEffect(() => {
    const dateParam = searchParams.get('date');
    const eventIdParam = searchParams.get('eventId');

    if (!dateParam && !eventIdParam) return;

    // 1) Move calendar to the correct date if provided
    if (dateParam) {
      const parsed = parseISO(dateParam);
      if (isValidDate(parsed)) {
        setCurrentDate(parsed);
        setView('day'); // Default to day view when deep-linking
      }
    }

    // 2) If an eventId is present, set it as highlighted
    if (eventIdParam) {
      setHighlightedEventId(eventIdParam);
    }
  }, [searchParams, setCurrentDate, setView]);

  // After events are loaded, scroll to / focus the event
  useEffect(() => {
    if (!highlightedEventId) return;
    if (!events || events.length === 0) return;

    const el = eventRefs.current[highlightedEventId];
    if (!el) return;

    // Scroll into view
    setTimeout(() => {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 100);

    // Brief highlight (remove after 2.5 seconds)
    const timeout = window.setTimeout(() => {
      setHighlightedEventId(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [highlightedEventId, events]);

  // Get events for a specific day
  const getEventsForDay = useCallback(
    (day: Date): CalendarEvent[] => {
      return events.filter((event) => {
        const startStr = event.start.dateTime || event.start.date;
        if (!startStr) return false;
        const startDate = parseISO(startStr);
        return isSameDay(startDate, day);
      });
    },
    [events]
  );

  // Render month view (simplest, start with this)
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 0,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {/* Day headers */}
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

        {/* Calendar days */}
        {calendarDays.map((day, index) => {
          const dayEvents = getEventsForDay(day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isTodayDate = isToday(day);

          return (
            <Box
              key={index}
              onClick={() => openCreateModal(day)}
              sx={{
                minHeight: 120,
                p: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: isCurrentMonth ? 'background.paper' : 'grey.50',
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: 'action.hover',
                },
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontWeight: isTodayDate ? 700 : 400,
                  color: isTodayDate ? 'primary.main' : isCurrentMonth ? 'text.primary' : 'text.disabled',
                  mb: 0.5,
                }}
              >
                {format(day, 'd')}
              </Typography>

              {/* Event chips */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {dayEvents.slice(0, 3).map((event) => (
                  <Box
                    key={event.id}
                    ref={(el: HTMLDivElement | null) => {
                      if (el) eventRefs.current[event.id] = el;
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(event);
                    }}
                    sx={{
                      px: 1,
                      py: 0.5,
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      borderRadius: 0.5,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      boxShadow: event.id === highlightedEventId 
                        ? '0 0 0 2px rgba(59, 130, 246, 0.9)' 
                        : 'none',
                      transition: 'box-shadow 0.2s ease-in-out',
                      '&:hover': {
                        bgcolor: 'primary.dark',
                      },
                    }}
                  >
                    {event.summary}
                  </Box>
                ))}
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
  };

  // Render week view
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM

    // Get all-day events for the week
    const allDayEvents = events.filter((event) => event.isAllDay);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* All-day events row */}
        {allDayEvents.length > 0 && (
          <Box
            sx={{
              borderBottom: '2px solid',
              borderColor: 'divider',
              minHeight: 40,
              p: 0.5,
              display: 'flex',
            }}
          >
            <Box sx={{ width: 60, flexShrink: 0 }} />
            {weekDays.map((day) => {
              const dayAllDayEvents = allDayEvents.filter((event) => {
                const startStr = event.start.date || event.start.dateTime;
                if (!startStr) return false;
                return isSameDay(parseISO(startStr), day);
              });

              return (
                <Box key={day.toISOString()} sx={{ flex: 1, borderRight: '1px solid', borderColor: 'divider', p: 0.5 }}>
                  {dayAllDayEvents.map((event) => (
                    <Box
                      key={event.id}
                      onClick={() => openEditModal(event)}
                      sx={{
                        px: 1,
                        py: 0.5,
                        mb: 0.5,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        borderRadius: 0.5,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:hover': { bgcolor: 'primary.dark' },
                      }}
                    >
                      {event.summary}
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Hourly grid */}
        <Box sx={{ flex: 1, overflow: 'auto', display: 'flex' }}>
          {/* Hour labels */}
          <Box sx={{ width: 60, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider' }}>
            {hours.map((hour) => (
              <Box
                key={hour}
                sx={{
                  height: 60,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  pr: 1,
                  pt: 0.5,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Day columns */}
          {weekDays.map((day) => {
            const dayTimedEvents = events.filter((event) => {
              if (event.isAllDay) return false;
              const startStr = event.start.dateTime;
              if (!startStr) return false;
              return isSameDay(parseISO(startStr), day);
            });

            return (
              <Box
                key={day.toISOString()}
                sx={{
                  flex: 1,
                  borderRight: '1px solid',
                  borderColor: 'divider',
                  position: 'relative',
                }}
              >
                {/* Hour rows */}
                {hours.map((hour) => (
                  <Box
                    key={hour}
                    onClick={() => {
                      const clickDate = new Date(day);
                      clickDate.setHours(hour, 0, 0, 0);
                      openCreateModal(clickDate);
                    }}
                    sx={{
                      height: 60,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  />
                ))}

                {/* Event blocks positioned absolutely */}
                {dayTimedEvents.map((event) => {
                  const startStr = event.start.dateTime;
                  if (!startStr) return null;
                  const startDate = parseISO(startStr);
                  const endStr = event.end.dateTime || startStr;
                  const endDate = parseISO(endStr);

                  const startHour = startDate.getHours() + startDate.getMinutes() / 60;
                  const endHour = endDate.getHours() + endDate.getMinutes() / 60;
                  const duration = endHour - startHour;

                  // Only show events within visible hours (6 AM - 11 PM)
                  if (startHour < 6 || startHour >= 24) return null;

                  const topPercent = ((startHour - 6) / 18) * 100;
                  const heightPercent = (duration / 18) * 100;

                  return (
                    <Box
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(event);
                      }}
                      sx={{
                        position: 'absolute',
                        top: `${Math.max(0, topPercent)}%`,
                        left: 4,
                        right: 4,
                        height: `${Math.max(3, heightPercent)}%`,
                        minHeight: 20,
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        borderRadius: 0.5,
                        p: 0.5,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        zIndex: 1,
                        '&:hover': { bgcolor: 'primary.dark', zIndex: 2 },
                      }}
                    >
                      <Typography variant="caption" fontWeight={600} noWrap>
                        {event.summary}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.9 }}>
                        {format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  };

  // Render day view
  const renderDayView = () => {
    const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM
    const dayEvents = getEventsForDay(currentDate);
    const allDayEvents = dayEvents.filter((event) => event.isAllDay);
    const timedEvents = dayEvents.filter((event) => !event.isAllDay);

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* All-day events */}
        {allDayEvents.length > 0 && (
          <Box
            sx={{
              borderBottom: '2px solid',
              borderColor: 'divider',
              minHeight: 40,
              p: 1,
            }}
          >
            {allDayEvents.map((event) => (
              <Box
                key={event.id}
                ref={(el: HTMLDivElement | null) => {
                  if (el) eventRefs.current[event.id] = el;
                }}
                onClick={() => openEditModal(event)}
                sx={{
                  px: 1.5,
                  py: 0.75,
                  mb: 0.5,
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  borderRadius: 0.5,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  boxShadow: event.id === highlightedEventId 
                    ? '0 0 0 2px rgba(59, 130, 246, 0.9)' 
                    : 'none',
                  transition: 'box-shadow 0.2s ease-in-out',
                  '&:hover': { bgcolor: 'primary.dark' },
                }}
              >
                {event.summary}
              </Box>
            ))}
          </Box>
        )}

        {/* Timeline */}
        <Box sx={{ flex: 1, overflow: 'auto', display: 'flex' }}>
          {/* Hour labels */}
          <Box sx={{ width: 80, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider' }}>
            {hours.map((hour) => (
              <Box
                key={hour}
                sx={{
                  height: 60,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  pr: 1.5,
                  pt: 0.5,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Event area */}
          <Box sx={{ flex: 1, position: 'relative' }}>
            {/* Hour rows */}
            {hours.map((hour) => (
              <Box
                key={hour}
                onClick={() => {
                  const clickDate = new Date(currentDate);
                  clickDate.setHours(hour, 0, 0, 0);
                  openCreateModal(clickDate);
                }}
                sx={{
                  height: 60,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              />
            ))}

            {/* Event blocks */}
            {timedEvents.map((event) => {
              const startStr = event.start.dateTime;
              if (!startStr) return null;
              const startDate = parseISO(startStr);
              const endStr = event.end.dateTime || startStr;
              const endDate = parseISO(endStr);

              const startHour = startDate.getHours() + startDate.getMinutes() / 60;
              const endHour = endDate.getHours() + endDate.getMinutes() / 60;
              const duration = endHour - startHour;

              // Only show events within visible hours
              if (startHour < 6 || startHour >= 24) return null;

              const topPercent = ((startHour - 6) / 18) * 100;
              const heightPercent = (duration / 18) * 100;

              return (
                <Box
                  key={event.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) eventRefs.current[event.id] = el;
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditModal(event);
                  }}
                  sx={{
                    position: 'absolute',
                    top: `${Math.max(0, topPercent)}%`,
                    left: 8,
                    right: 8,
                    height: `${Math.max(4, heightPercent)}%`,
                    minHeight: 32,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    borderRadius: 1,
                    p: 1,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    zIndex: 1,
                    boxShadow: event.id === highlightedEventId 
                      ? '0 0 0 3px rgba(59, 130, 246, 0.9)' 
                      : 1,
                    transition: 'box-shadow 0.2s ease-in-out',
                    '&:hover': { bgcolor: 'primary.dark', zIndex: 2, boxShadow: 2 },
                  }}
                >
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {event.summary}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.9 }}>
                    {format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}
                  </Typography>
                  {event.location && (
                    <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5 }}>
                      {event.location}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
      </Box>
    );
  };

  // Sidebar content
  const sidebarContent = (
    <Box sx={{ width: 280, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* My Calendars */}
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          My Calendars
        </Typography>
        {calendarsLoading ? (
          <CircularProgress size={20} />
        ) : (
          <List dense sx={{ py: 0 }}>
            {calendars.map((calendar) => (
              <ListItem key={calendar.id} disablePadding>
                <ListItemButton
                  onClick={() => toggleCalendar(calendar.id)}
                  sx={{ py: 0.5, px: 1 }}
                >
                  <Checkbox
                    edge="start"
                    checked={selectedCalendarIds.has(calendar.id)}
                    tabIndex={-1}
                    disableRipple
                    size="small"
                  />
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: calendar.backgroundColor || '#7986cb',
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary={calendar.summary}
                    primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      <Divider />

      {/* Upcoming Events */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Upcoming
        </Typography>
        {eventsLoading ? (
          <CircularProgress size={20} />
        ) : upcomingEvents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No upcoming events
          </Typography>
        ) : (
          <List dense>
            {upcomingEvents.map((event) => {
              const startStr = event.start.dateTime || event.start.date;
              const startDate = startStr ? parseISO(startStr) : new Date();
              const isTodayEvent = isToday(startDate);
              const timeLabel = isTodayEvent
                ? `Today ${format(startDate, 'h:mm a')}`
                : format(startDate, 'EEE h:mm a');

              return (
                <ListItem
                  key={event.id}
                  disablePadding
                  onClick={() => {
                    setCurrentDate(startDate);
                    setView('day');
                    openEditModal(event);
                  }}
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <ListItemButton sx={{ py: 0.5, px: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: calendars.find((c) => c.id === event.calendarId)?.backgroundColor || '#7986cb',
                        mr: 1,
                        flexShrink: 0,
                      }}
                    />
                    <ListItemText
                      primary={event.summary}
                      secondary={timeLabel}
                      primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                      secondaryTypographyProps={{ variant: 'caption' }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          px: 3,
          py: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
          {isMobile && (
            <IconButton onClick={() => setSidebarOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h5" fontWeight={700}>
            Calendar
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button startIcon={<TodayIcon />} onClick={goToToday} size="small">
            Today
          </Button>
          <IconButton onClick={goToPrevious} size="small">
            <ChevronLeftIcon />
          </IconButton>
          <IconButton onClick={goToNext} size="small">
            <ChevronRightIcon />
          </IconButton>
          <ToggleButtonGroup
            value={view}
            exclusive
            onChange={(_, newView) => newView && setView(newView)}
            size="small"
          >
            <ToggleButton value="day">Day</ToggleButton>
            <ToggleButton value="week">Week</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => openCreateModal()}
            sx={{ ml: 2 }}
          >
            New Event
          </Button>
        </Box>
      </Paper>

      {/* Main Content */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        {isDesktop ? (
          sidebarContent
        ) : (
          <Drawer
            anchor="left"
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            PaperProps={{ sx: { width: 280 } }}
          >
            {sidebarContent}
          </Drawer>
        )}

        {/* Calendar View */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
          {view === 'month' && renderMonthView()}
          {view === 'week' && renderWeekView()}
          {view === 'day' && renderDayView()}
        </Box>
      </Box>

      {/* Event Modal */}
      <EventModal
        open={eventModalOpen}
        mode={eventModalMode}
        userId={userId}
        initialEvent={eventModalMode === 'edit' ? selectedEvent : null}
        defaultStart={eventModalMode === 'create' ? createEventDate : undefined}
        onClose={() => setEventModalOpen(false)}
        onSaved={handleEventSaved}
      />
    </Box>
  );
};

export default CalendarPage;
