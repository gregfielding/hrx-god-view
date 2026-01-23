import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardHeader,
  CardContent,
  Drawer,
  Divider,
  IconButton,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Avatar,
  Tooltip,
  Badge,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Add as AddIcon,
  CalendarMonth as CalendarMonthIcon,
  Event as EventIcon,
  Schedule as ScheduleIcon,
  LocationOn as LocationIcon,
  Person as PersonIcon,
  Business as BusinessIcon,
  Close as CloseIcon,
  ViewModule as ViewModuleIcon,
  ViewDay as ViewDayIcon,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  isToday,
  parseISO,
} from 'date-fns';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../firebase';
import { DASHBOARD_WIDGET } from '../utils/dashboardWidgetTokens';
import type { DashboardCalendarEventInput } from '../types/dashboardCalendar';
import { CallableCache } from '../utils/callableCache';
import EventModal from './calendar/EventModal';
import type { CalendarEvent as SpecCalendarEvent } from '../types/calendar';

type CachedGoogleEventsPayload = {
  at: number;
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    type: 'google_calendar';
    description?: string;
    location?: string;
    attendees?: any[];
    color?: string;
    relatedTo?: any;
  }>;
};

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'crm_appointment' | 'google_calendar';
  description?: string;
  location?: string;
  attendees?: string[];
  color?: string;
  relatedTo?: {
    type: string;
    id: string;
    name: string;
  };
}

interface CalendarWidgetProps {
  userId: string;
  tenantId: string;
  preloadedContacts?: any[];
  preloadedSalespeople?: any[];
  preloadedCompanies?: any[];
  preloadedDeals?: any[];
  variant?: 'default' | 'dashboard' | 'page';
  initialView?: 'today' | 'week' | 'month';
}

const CalendarWidget: React.FC<CalendarWidgetProps> = ({
  userId,
  tenantId,
  preloadedContacts = [],
  preloadedSalespeople = [],
  preloadedCompanies = [],
  preloadedDeals = [],
  variant = 'default',
  initialView,
}) => {
  const isDashboard = variant === 'dashboard';
  const isPage = variant === 'page';
  const showSourceChips = !isDashboard;
  const showMonthInUi = !isDashboard; // keep month logic, hide UI for dashboard

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [view, setView] = useState<'today' | 'week' | 'month'>(() => {
    if (variant === 'page') return initialView || 'month';
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('calendar_view') : null;
    if (saved === 'day') return 'today'; // migrate old "day" view to Today-first
    return (saved === 'today' || saved === 'week' || saved === 'month') ? (saved as any) : 'today';
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventDrawer, setShowEventDrawer] = useState(false);
  const [loading, setLoading] = useState(true);

  const thinLightScrollbarSx = useMemo(
    () => ({
      '&::-webkit-scrollbar': { width: '6px', height: '6px' },
      '&::-webkit-scrollbar-track': {
        background: 'rgba(0, 0, 0, 0.02)',
        borderRadius: '4px',
      },
      '&::-webkit-scrollbar-thumb': {
        background: 'rgba(0, 0, 0, 0.12)',
        borderRadius: '4px',
        '&:hover': { background: 'rgba(0, 0, 0, 0.20)' },
      },
      scrollbarWidth: 'thin',
      scrollbarColor: 'rgba(0, 0, 0, 0.12) rgba(0, 0, 0, 0.02)',
    }),
    [],
  );

  // Persist callable cache across renders (was previously re-created per fetch, defeating caching)
  const calendarEventsCache = useMemo(() => new CallableCache(90 * 60 * 1000), []);

  // Compute the visible window to fetch from Google so "earlier today" and date navigation work.
  const googleFetchRange = useMemo(() => {
    const base = view === 'month' ? currentDate : selectedDate;
    if (view === 'month') {
      // Include full visible month grid range
      const start = startOfWeek(startOfMonth(base));
      const end = endOfWeek(endOfMonth(base));
      return { start, end };
    }
    if (view === 'week') {
      return { start: startOfWeek(base), end: endOfWeek(base) };
    }
    return { start: startOfDay(base), end: endOfDay(base) };
  }, [view, selectedDate, currentDate]);

  // EventModal state
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventModalMode, setEventModalMode] = useState<'create' | 'edit'>('create');
  const [eventModalInitialEvent, setEventModalInitialEvent] = useState<SpecCalendarEvent | null>(null);

  // Dashboard variant: if month was persisted, don't show month in UI. Snap back to Today.
  useEffect(() => {
    if (!showMonthInUi && view === 'month') {
      setView('today');
      try { window.localStorage.setItem('calendar_view', 'today'); } catch {}
    }
  }, [showMonthInUi, view]);

  // Helper function to safely convert dates
  const safeDateConversion = (dateValue: any): Date => {
    if (!dateValue) return new Date();
    
    // If it's already a Date object
    if (dateValue instanceof Date) return dateValue;
    
    // If it's a Firestore timestamp
    if (dateValue && typeof dateValue.toDate === 'function') {
      return dateValue.toDate();
    }
    
    // If it's a string or number, try to create a Date
    try {
      return new Date(dateValue);
    } catch (error) {
      console.warn('Failed to convert date value:', dateValue, error);
      return new Date();
    }
  };

  // Calendar navigation
  const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
  const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
    setView('today');
  };

  // Today/Week navigation
  const goToPreviousPeriod = () => {
    if (view === 'month') {
      setCurrentDate(subMonths(currentDate, 1));
      return;
    }
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - (view === 'week' ? 7 : 1));
    setSelectedDate(prev);
    setCurrentDate(prev);
  };

  const goToNextPeriod = () => {
    if (view === 'month') {
      setCurrentDate(addMonths(currentDate, 1));
      return;
    }
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + (view === 'week' ? 7 : 1));
    setSelectedDate(next);
    setCurrentDate(next);
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setCurrentDate(date);
    setView('today');
  };

  const handleViewChange = (newView: 'today' | 'week' | 'month') => {
    // If the user explicitly selects "Today", snap the date back to real today.
    // This preserves the old Today-icon behavior while allowing the Dashboard header icon to be a link.
    if (newView === 'today') {
      const today = new Date();
      setCurrentDate(today);
      setSelectedDate(today);
    }
    setView(newView);
    if (newView === 'month') {
      setCurrentDate(selectedDate);
    }
    try { window.localStorage.setItem('calendar_view', newView); } catch {}
  };

  const handleOpenAddEvent = () => {
    if (!isDashboard) {
      window.location.assign('/crm?tab=tasks');
      return;
    }
    setEventModalMode('create');
    setEventModalInitialEvent(null);
    setShowEventModal(true);
  };

  const handleEventModalSaved = async (savedEvent: SpecCalendarEvent) => {
    // Convert spec CalendarEvent to widget CalendarEvent format and add to events
    // For now, since we're using mocked data, we'll just trigger a refresh of Google events
    // In the future, we can optimistically add the event or refresh from the backend
    
    // Force-refresh Google events (bypass the 90m client cache used in the initial load)
    try {
      const functions = getFunctions();
      const listCalendarEventsFn = httpsCallable(functions, 'listCalendarEventsOptimized');
      const payloadList = {
        userId,
        maxResults: 50,
        timeMin: googleFetchRange.start.toISOString(),
        timeMax: googleFetchRange.end.toISOString(),
      };
      const calendarData: any = (await listCalendarEventsFn(payloadList)).data as any;
      if (calendarData?.success && Array.isArray(calendarData.events)) {
        const googleEvents: CalendarEvent[] = calendarData.events.map((event: any) => ({
          id: event.id,
          title: event.summary || 'Untitled Event',
          start: safeDateConversion(event.start?.dateTime || event.start?.date),
          end: safeDateConversion(event.end?.dateTime || event.end?.date),
          type: 'google_calendar',
          description: event.description,
          location: event.location,
          attendees: event.attendees || [],
          color: '#4caf50',
          relatedTo: event.relatedTo,
        }));
        setEvents((prev) => {
          const filtered = prev.filter((e) => e.type !== 'google_calendar');
          return [...filtered, ...googleEvents];
        });
      }
    } catch {
      // If refresh fails, event was still created; the next reload will pick it up.
    }
  };

  // Keyboard navigation for month view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showEventDrawer) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCloseEventDrawer();
        }
        return;
      }
      if (view !== 'month') return;
      let handled = true;
      if (e.key === 'ArrowLeft') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 1));
      else if (e.key === 'ArrowRight') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
      else if (e.key === 'ArrowUp') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() - 7));
      else if (e.key === 'ArrowDown') setSelectedDate(prev => new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 7));
      else if (e.key === 'Enter') { handleDayClick(selectedDate); }
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, showEventDrawer, selectedDate]);

  // Get calendar days for the current month view
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate]);

  // Load CRM appointments (from tasks collection).
  // Important: keep this subscription stable (only depends on userId/tenantId) to avoid
  // Firestore internal assertion errors caused by rapid resubscribe churn.
  useEffect(() => {
    if (!userId || !tenantId) return;
    const tasksRef = collection(db, 'tenants', tenantId, 'tasks');
    const appointmentsQuery = query(
      tasksRef,
      where('classification', '==', 'appointment'),
      where('assignedTo', '==', userId)
    );

    const unsubscribe = onSnapshot(
      appointmentsQuery,
      (snapshot) => {
        const crmEvents: CalendarEvent[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();

          // Handle different date field names
          const startTime = data.startTime || data.scheduledDate || data.dueDate;
          const endTime = data.endTime || data.scheduledDate || data.dueDate;

          return {
            id: docSnap.id,
            title: data.title || data.name || 'Untitled Appointment',
            start: safeDateConversion(startTime),
            end: safeDateConversion(endTime),
            type: 'crm_appointment',
            description: data.description || data.notes,
            location: data.location,
            attendees: data.attendees || [],
            color: '#1976d2', // Blue for CRM appointments
            relatedTo: data.relatedTo,
          };
        });

        setEvents((prev) => {
          const filtered = prev.filter((e) => e.type !== 'crm_appointment');
          return [...filtered, ...crmEvents];
        });
      },
      (error) => {
        console.info('📅 CRM appointments not accessible (permission-denied):', error.code);
      }
    );

    return () => unsubscribe();
  }, [userId, tenantId]);

  // Load Google Calendar events (from activities collection and direct API)
  useEffect(() => {
    if (!userId || !tenantId) return;

    const unsubscribeFunctions: (() => void)[] = [];

    const loadGoogleCalendarEvents = async () => {
      const cacheKeySession = `calendarWidget.googleEvents.v1:${userId}:${tenantId}:${googleFetchRange.start.toISOString().slice(0, 10)}:${googleFetchRange.end.toISOString().slice(0, 10)}`;

      // Hydrate from sessionStorage immediately (stale-while-revalidate) to avoid flicker.
      try {
        const raw = sessionStorage.getItem(cacheKeySession);
        if (raw) {
          const parsed = JSON.parse(raw) as CachedGoogleEventsPayload;
          if (parsed?.events?.length) {
            const cachedGoogleEvents: CalendarEvent[] = parsed.events.map((e) => ({
              id: e.id,
              title: e.title,
              start: safeDateConversion(e.start),
              end: safeDateConversion(e.end),
              type: 'google_calendar',
              description: e.description,
              location: e.location,
              attendees: e.attendees || [],
              color: e.color || '#4caf50',
              relatedTo: e.relatedTo,
            }));

            setEvents((prev) => {
              const filtered = prev.filter((ev) => ev.type !== 'google_calendar');
              // Only hydrate if we don't already have google events; avoids oscillation on quick range changes.
              const hasGoogle = prev.some((ev) => ev.type === 'google_calendar');
              return hasGoogle ? prev : [...filtered, ...cachedGoogleEvents];
            });
          }
        }
      } catch {
        // ignore cache parse issues
      }

      try {
        // First try to get Google Calendar events via API (like appointments widget does)
        const functions = getFunctions();
        const listCalendarEvents = httpsCallable(functions, 'listCalendarEventsOptimized');
        const payload = {
          userId,
          maxResults: 50,
          timeMin: googleFetchRange.start.toISOString(),
          timeMax: googleFetchRange.end.toISOString(),
        };
        const cacheKey = `listCalendarEvents:${userId}:${view}:${payload.timeMin.slice(0, 10)}:${payload.timeMax.slice(0, 10)}`;
        const calendarResult: any = await calendarEventsCache.getOrFetch(cacheKey, async () => (await listCalendarEvents(payload)).data as any);
        const calendarData = calendarResult as any;
        
        if (calendarData.success && Array.isArray(calendarData.events)) {
          console.log(`📅 Loaded ${calendarData.events.length} Google Calendar events via API for user ${userId}`);
          const googleEvents: CalendarEvent[] = calendarData.events.map((event: any) => ({
            id: event.id,
            title: event.summary || 'Untitled Event',
            start: safeDateConversion(event.start?.dateTime || event.start?.date),
            end: safeDateConversion(event.end?.dateTime || event.end?.date),
            type: 'google_calendar',
            description: event.description,
            location: event.location,
            attendees: event.attendees || [],
            color: '#4caf50', // Green for Google Calendar events
            relatedTo: event.relatedTo,
          }));
          
          setEvents((prev) => {
            const hadGoogleBefore = prev.some((e) => e.type === 'google_calendar');
            // Guard: don't blow away previously-seen events if the API returns an empty list unexpectedly.
            if (hadGoogleBefore && googleEvents.length === 0) return prev;
            const filtered = prev.filter((e) => e.type !== 'google_calendar');
            return [...filtered, ...googleEvents];
          });

          // Persist a lightweight cache so refreshes and transient fetch issues don't clear the UI.
          try {
            const payloadToCache: CachedGoogleEventsPayload = {
              at: Date.now(),
              events: googleEvents.map((e) => ({
                id: e.id,
                title: e.title,
                start: e.start.toISOString(),
                end: e.end.toISOString(),
                type: 'google_calendar',
                description: e.description,
                location: e.location,
                attendees: e.attendees,
                color: e.color,
                relatedTo: e.relatedTo,
              })),
            };

            // Only overwrite an existing non-empty cache with non-empty data.
            if (payloadToCache.events.length > 0) {
              sessionStorage.setItem(cacheKeySession, JSON.stringify(payloadToCache));
            } else {
              const existing = sessionStorage.getItem(cacheKeySession);
              if (!existing) sessionStorage.setItem(cacheKeySession, JSON.stringify(payloadToCache));
            }
          } catch {
            // ignore cache write errors
          }
        }
      } catch (calendarError: any) {
        console.warn('Google Calendar API not accessible:', calendarError);
        // Fall back to synced events from activities collection
      }

      // Also load calendar events that were synced into CRM activities
      // This fallback is disabled by default to avoid permission errors and duplicate renders.
      // Enable by setting localStorage feature.calendarActivitiesFallback = 'true'
      let enableActivitiesFallback = false;
      try {
        enableActivitiesFallback = localStorage.getItem('feature.calendarActivitiesFallback') === 'true';
      } catch {}
      if (enableActivitiesFallback) {
        const activitiesRef = collection(db, 'tenants', tenantId, 'activities');
        const activitiesQuery = query(
          activitiesRef,
          where('type', '==', 'calendar_event'),
          where('createdBy', '==', userId)
        );

        const unsubscribe = onSnapshot(activitiesQuery, (snapshot) => {
          console.log(`📅 Loaded ${snapshot.docs.length} synced calendar events from activities for user ${userId}`);
          const syncedEvents: CalendarEvent[] = snapshot.docs.map(doc => {
            const data = doc.data();
            const startDate = safeDateConversion(data.date);
            return {
              id: data.calendarEventId || doc.id,
              title: data.title || 'Calendar Event',
              start: startDate,
              end: startDate, // Use same time for synced events
              type: 'google_calendar',
              description: data.description,
              location: data.location,
              attendees: data.attendees || [],
              color: '#4caf50', // Green for Google Calendar events
              relatedTo: data.relatedTo,
            };
          });
          
          setEvents(prev => {
            const filtered = prev.filter(e => e.type !== 'google_calendar');
            return [...filtered, ...syncedEvents];
          });
        }, (error) => {
          if (process.env.NODE_ENV === 'development') {
            console.info('📅 Calendar activities not accessible (permission-denied):', error.code);
          }
        });

        unsubscribeFunctions.push(unsubscribe);
      }
    };

    loadGoogleCalendarEvents().catch(error => {
      console.error('Error loading Google Calendar events:', error);
    });

    setLoading(false);

    // Cleanup function
    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }, [userId, tenantId, googleFetchRange.start, googleFetchRange.end, calendarEventsCache]);

  // Get events for a specific day
  const getEventsForDay = (date: Date) => {
    return events.filter(event => isSameDay(event.start, date));
  };

  // Get events for a specific day sorted by time
  const getEventsForDaySorted = (date: Date) => {
    const dayEvents = getEventsForDay(date);
    return dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
  };

  // Get related entity name
  const getRelatedEntityName = (relatedTo?: { type: string; id: string; name: string }) => {
    if (!relatedTo) return null;

    switch (relatedTo.type) {
      case 'contact': {
        const contact = preloadedContacts.find(c => c.id === relatedTo.id);
        return contact?.fullName || contact?.name || relatedTo.name;
      }
      case 'company': {
        const company = preloadedCompanies.find(c => c.id === relatedTo.id);
        return company?.companyName || company?.name || relatedTo.name;
      }
      case 'deal': {
        const deal = preloadedDeals.find(d => d.id === relatedTo.id);
        return deal?.name || relatedTo.name;
      }
      default:
        return relatedTo.name;
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowEventDrawer(true);
  };

  const handleCloseEventDrawer = () => {
    setShowEventDrawer(false);
    setSelectedEvent(null);
  };

  const handleEditAppointment = () => {
    if (!selectedEvent || selectedEvent.type !== 'crm_appointment') return;
    try {
      // Notify Tasks UI to open edit dialog; also navigate to tasks tab
      const evt = new CustomEvent('openTaskEditDialog', { detail: { taskId: selectedEvent.id, tenantId } });
      window.dispatchEvent(evt);
      // Best-effort navigate to tasks tab
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'tasks');
      url.searchParams.set('editTaskId', selectedEvent.id);
      window.history.pushState({}, '', url.toString());
    } catch {}
    handleCloseEventDrawer();
  };

  const handleDeleteAppointment = async () => {
    if (!selectedEvent || selectedEvent.type !== 'crm_appointment') return;
    try {
      const confirm = window.confirm('Delete this appointment? This cannot be undone.');
      if (!confirm) return;
      const functions = getFunctions();
      const deleteTask = httpsCallable(functions, 'deleteTask');
      await deleteTask({ tenantId, taskId: selectedEvent.id });
      handleCloseEventDrawer();
    } catch (e) {
      console.error('Failed to delete appointment', e);
      alert('Failed to delete appointment.');
    }
  };

  // Helpers for event details rendering
  const getAttendeeLabel = (attendee: any): string => {
    if (!attendee) return '';
    if (typeof attendee === 'string') return attendee;
    return attendee.email || attendee.displayName || attendee.name || '';
  };

  const linkifyDescription = (desc?: string): string => {
    if (!desc) return '';
    // If it already looks like HTML, render as is
    const looksLikeHtml = /<[^>]+>/.test(desc);
    if (looksLikeHtml) return desc;
    // Escape HTML entities first
    let html = desc
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Convert <https://...> style links
    html = html.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // Convert bare URLs
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    // Convert newlines
    html = html.replace(/\n/g, '<br/>');
    return html;
  };

  return (
    <Card
      sx={
        isDashboard
          ? {
              borderRadius: `${DASHBOARD_WIDGET.outerRadiusPx}px`,
              border: '1px solid #EAEEF4',
              boxShadow: 'none',
              overflow: 'hidden',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              padding: '8px',
            }
          : isPage
            ? {
                borderRadius: 0,
                boxShadow: 'none',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }
          : undefined
      }
    >
      <CardHeader
        title="Calendar"
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={(e, newView) => newView && handleViewChange(newView)}
              size="small"
            >
              <ToggleButton value="today" aria-label="today view">
                Today
              </ToggleButton>
              <ToggleButton value="week" aria-label="week view">
                Week
              </ToggleButton>
              {showMonthInUi && (
                <ToggleButton value="month" aria-label="month view">
                  Month
                </ToggleButton>
              )}
            </ToggleButtonGroup>
            {isDashboard ? (
              <>
                <Tooltip title="Open Calendar">
                  <IconButton
                    size="small"
                    component={Link}
                    to="/calendar"
                    sx={{ width: 44, height: 44 }}
                    aria-label="Open calendar page"
                  >
                    <CalendarMonthIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Add Event">
                  <IconButton
                    size="small"
                    onClick={handleOpenAddEvent}
                    sx={{ width: 44, height: 44 }}
                    aria-label="Add calendar event"
                  >
                    <AddIcon />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              <IconButton size="small" onClick={goToToday}>
                <TodayIcon />
              </IconButton>
            )}
          </Box>
        }
        titleTypographyProps={{ variant: 'h6', fontWeight: 'bold' }}
        sx={
          isDashboard
            ? {
                px: 2,     // 16px side padding
                pt: 2,     // 16px top padding
                pb: 0.75,
                '& .MuiCardHeader-action': { alignSelf: 'center' },
              }
            : undefined
        }
      />
      <CardContent
        sx={
          isDashboard
            ? {
                px: 2,
                pb: 2,
                pt: 0,
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              } // 16px sides + bottom
            : isPage
              ? { px: 0, pb: 0, pt: 0, flex: 1, minHeight: 0, overflow: 'hidden' }
              : undefined
        }
      >
        {/* Calendar Navigation */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <IconButton 
            onClick={goToPreviousPeriod} 
            size="small"
          >
            <ChevronLeftIcon />
          </IconButton>
          <Typography
            variant={isDashboard ? 'subtitle1' : 'h6'}
            sx={{
              fontWeight: 'bold',
              ...(isDashboard ? { fontSize: '1.05rem' } : null),
            }}
          >
            {view === 'month'
              ? format(currentDate, 'MMMM yyyy')
              : view === 'week'
                ? `Week of ${format(startOfWeek(selectedDate), 'MMM d')}`
                : (isToday(selectedDate) ? `Today — ${format(selectedDate, 'MMM d')}` : format(selectedDate, 'EEEE, MMM d'))
            }
          </Typography>
          <IconButton 
            onClick={goToNextPeriod} 
            size="small"
          >
            <ChevronRightIcon />
          </IconButton>
        </Box>

        {/* Calendar Content */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'month' ? (
          /* Month View */
          <Box sx={{ 
            display: 'grid', 
            overflow: 'auto',
            gridTemplateColumns: 'repeat(7, 1fr)', 
            gap: 0,
            width: '100%',
            minWidth: 0,
            '& > *': {
              minWidth: 0,
              width: '100%'
            }
          }}>
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <Box
              key={day}
              sx={{
                p: 1,
                textAlign: 'center',
                fontWeight: 'bold',
                fontSize: '0.875rem',
                color: 'text.secondary',
                backgroundColor: '#f5f5f5',
                borderRadius: 0,
                border: '1px solid #e0e0e0',
                width: '100%',
                minWidth: 0,
                overflow: 'hidden',
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
                onClick={() => handleDayClick(day)}
                sx={{
                  minHeight: 80,
                  p: 0.5,
                  border: '1px solid #e0e0e0',
                  borderRadius: 0,
                  backgroundColor: isTodayDate ? '#e3f2fd' : 'white',
                  cursor: 'pointer',
                  width: '100%',
                  minWidth: 0,
                  overflow: 'hidden',
                  '&:hover': {
                    backgroundColor: '#f5f5f5',
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: isSameDay(day, selectedDate) ? 'bold' : 'medium',
                    color: isCurrentMonth ? 'text.primary' : 'text.disabled',
                    mb: 0.5,
                  }}
                >
                  <Box component="span" sx={{
                    px: 0.5,
                    borderRadius: 0.5,
                    backgroundColor: isTodayDate ? '#e8f0fe' : 'transparent'
                  }}>
                    {format(day, 'd')}
                  </Box>
                </Typography>

                {/* Events for this day */}
                <Box sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: 0.5,
                  width: '100%',
                  minWidth: 0,
                  overflow: 'auto'
                }}>
                  {dayEvents.slice(0, 2).map((event) => (
                    <Tooltip title={event.title} placement="top" key={event.id}>
                    <Box
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEventClick(event);
                      }}
                      tabIndex={0}
                      aria-label={`${format(event.start,'h:mm a')} — ${event.title}`}
                      sx={{
                        p: 0.5,
                        backgroundColor: event.color,
                        color: 'white',
                        borderRadius: 1,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        overflow: 'auto',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        '&:hover': {
                          opacity: 0.8,
                        },
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'white', opacity: 0.9, mr: 0.75 }} />
                      <span>{event.title}</span>
                    </Box>
                    </Tooltip>
                  ))}
                  {dayEvents.length > 2 && (
                    <Typography 
                      variant="caption" 
                      color="text.secondary"
                      sx={{ textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={(e)=>{ e.stopPropagation(); handleDayClick(day); }}
                    >
                      +{dayEvents.length - 2} more
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
        ) : view === 'week' ? (
          /* Week View (simple agenda) */
          <Box
            sx={{
              border: '1px solid #e0e0e0',
              borderRadius: `${DASHBOARD_WIDGET.innerRadiusPx}px`,
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              maxHeight: 'none',
              p: isDashboard ? 1 : 1,
              pb: 1, // 8px bottom padding inside scroll area
              ...thinLightScrollbarSx,
            }}
          >
            {eachDayOfInterval({ start: startOfWeek(selectedDate), end: endOfWeek(selectedDate) }).map((day) => {
              const dayEvents = getEventsForDaySorted(day);
              return (
                <Box key={day.toISOString()} sx={{ mb: 2 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 700,
                      mb: 0.75,
                      ...(isDashboard ? { fontSize: '0.8125rem' } : null),
                    }}
                  >
                    {format(day, 'EEE, MMM d')}
                  </Typography>
                  {dayEvents.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      No events
                    </Typography>
                  ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {dayEvents.map((event) => (
                        <Box
                          key={event.id}
                          onClick={() => handleEventClick(event)}
                          sx={{
                            p: 1,
                            borderRadius: 1,
                            border: '1px solid #EAEEF4',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.02)' },
                            display: 'flex',
                            alignItems: 'center',
                            overflow: 'auto',
                            gap: 1,
                          }}
                        >
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: event.color || '#999', flexShrink: 0 }} />
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {format(event.start, 'h:mm a')}
                          </Typography>
                          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {event.title}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        ) : (
          /* Today-first view (agenda) */
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {!isDashboard && (
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {isToday(selectedDate) ? `Today — ${format(selectedDate, 'MMM d')}` : format(selectedDate, 'EEEE, MMM d')}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={handleOpenAddEvent}
                  sx={{ textTransform: 'none', borderRadius: '999px' }}
                >
                  Add Event
                </Button>
              </Box>
            )}

            <Box
              sx={{
                border: '1px solid #EAEEF4',
                borderRadius: `${DASHBOARD_WIDGET.innerRadiusPx}px`,
                flex: 1,
                minHeight: 0,
                p: isDashboard ? 1 : 1,
                overflow: 'auto',
                maxHeight: 'none',
                pb: 1, // 8px bottom padding inside scroll area
                ...thinLightScrollbarSx,
              }}
            >
              {(() => {
                const dayEvents = getEventsForDaySorted(selectedDate);
                if (dayEvents.length === 0) {
                  return (
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
                      No events scheduled.
                    </Typography>
                  );
                }

                const now = new Date();
                const isTodayDate = isToday(selectedDate);
                const earlier = isTodayDate ? dayEvents.filter((e) => e.end.getTime() < now.getTime()) : [];
                const upcoming = isTodayDate ? dayEvents.filter((e) => e.end.getTime() >= now.getTime()) : dayEvents;

                const renderEventRow = (event: CalendarEvent) => (
                  <Box
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    sx={{
                      py: 0.375,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      cursor: 'pointer',
                      '&:hover': { opacity: 0.9 },
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: event.color || '#999', flexShrink: 0 }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 84, lineHeight: 1.5 }}>
                      {format(event.start, 'h:mm a')}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        lineHeight: 1.5,
                      }}
                    >
                      {event.title}
                    </Typography>
                  </Box>
                );

                return (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.375 }}>
                    {upcoming.map(renderEventRow)}
                    {earlier.length > 0 && (
                      <>
                        <Divider sx={{ my: 1 }} />
                        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6B7280' }}>
                          Earlier Today
                        </Typography>
                        {earlier.map(renderEventRow)}
                      </>
                    )}
                  </Box>
                );
              })()}
            </Box>
          </Box>
        )}
        </Box>

        {/* Event Details Drawer (drawer-first) */}
        <Drawer
          anchor="right"
          open={showEventDrawer}
          onClose={handleCloseEventDrawer}
          PaperProps={{
            sx: {
              width: { xs: '100%', sm: 420 },
              minWidth: { sm: 420 },
              maxWidth: { sm: 420 },
              // Prevent any perceived "shrink" when scrollbars appear on hover.
              overflowY: 'scroll',
              scrollbarGutter: 'stable',
              '&:hover': {
                width: { xs: '100%', sm: 420 },
                minWidth: { sm: 420 },
                maxWidth: { sm: 420 },
              },
            },
          }}
        >
          <Box sx={{ p: 2.5, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <EventIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {selectedEvent?.title || 'Event'}
                </Typography>
              </Box>
              {selectedEvent?.type && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {selectedEvent.type === 'crm_appointment' ? 'CRM Appointment' : 'Google Calendar'}
                </Typography>
              )}
            </Box>
            <IconButton onClick={handleCloseEventDrawer} sx={{ width: 44, height: 44 }}>
              <CloseIcon />
            </IconButton>
          </Box>

          <Divider />

          <Box sx={{ p: 2.5 }}>
            {selectedEvent?.description && (
              <Box sx={{ mb: 2, color: 'text.secondary' }} dangerouslySetInnerHTML={{ __html: linkifyDescription(selectedEvent.description) }} />
            )}

            {selectedEvent && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ScheduleIcon fontSize="small" color="action" />
                  <Typography variant="body2">
                    {format(selectedEvent.start, 'MMM d, yyyy h:mm a')} — {format(selectedEvent.end, 'h:mm a')}
                  </Typography>
                </Box>

                {selectedEvent.location && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LocationIcon fontSize="small" color="action" />
                    <Typography variant="body2">{selectedEvent.location}</Typography>
                  </Box>
                )}

                {selectedEvent.relatedTo && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {selectedEvent.relatedTo.type === 'contact' && <PersonIcon fontSize="small" color="action" />}
                    {selectedEvent.relatedTo.type === 'company' && <BusinessIcon fontSize="small" color="action" />}
                    <Typography variant="body2">
                      Related to: {getRelatedEntityName(selectedEvent.relatedTo)}
                    </Typography>
                  </Box>
                )}

                {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Attendees: {selectedEvent.attendees.map(getAttendeeLabel).filter(Boolean).join(', ')}
                  </Typography>
                )}
              </Box>
            )}
          </Box>

          <Box sx={{ mt: 'auto', p: 2.5, display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            {selectedEvent?.type === 'crm_appointment' && (
              <>
                <Button onClick={handleEditAppointment} variant="outlined" sx={{ textTransform: 'none', borderRadius: '24px' }}>
                  Edit
                </Button>
                <Button onClick={handleDeleteAppointment} color="error" variant="outlined" sx={{ textTransform: 'none', borderRadius: '24px' }}>
                  Delete
                </Button>
              </>
            )}
            <Button onClick={handleCloseEventDrawer} variant="contained" sx={{ textTransform: 'none', borderRadius: '24px' }}>
              Close
            </Button>
          </Box>
        </Drawer>

        {/* EventModal (shared component) */}
        {isDashboard && (
          <EventModal
            open={showEventModal}
            mode={eventModalMode}
            userId={userId}
            initialEvent={eventModalInitialEvent}
            defaultStart={selectedDate}
            onClose={() => setShowEventModal(false)}
            onSaved={handleEventModalSaved}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default CalendarWidget;
