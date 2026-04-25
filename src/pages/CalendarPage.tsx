/**
 * Calendar Page
 * 
 * Full-screen calendar page with Month/Week/Day views, sidebar, and event management.
 * Phase 2 implementation per calendar-phase2-calendar-page-and-feed.md
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  useMediaQuery,
  useTheme,
  Paper,
  Divider,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Today as TodayIcon,
  Add as AddIcon,
  Menu as MenuIcon,
} from '@mui/icons-material';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay, addDays, subDays, addWeeks, subWeeks, addMonths, subMonths, isSameDay, isSameMonth, isToday, eachDayOfInterval, parseISO, isValid as isValidDate, differenceInCalendarDays } from 'date-fns';
import { useAuth } from '../contexts/AuthContext';
import { useCalendarList } from '../hooks/useCalendarList';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarRealtime } from '../hooks/useCalendarRealtime';
import { useGigJobOrdersCalendar, getGigJobOrdersCalendarSummary, getColorForJobOrderId } from '../hooks/useGigJobOrdersCalendar';
import EventModal from '../components/calendar/EventModal';
import type { CalendarEvent, CalendarView, CalendarSummary } from '../types/calendar';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { renderShiftTooltip } from '../utils/calendarShiftTooltip';

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
  const userEmail = (user?.email || '').toLowerCase();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg')); // < 1024px
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // View state
  const [view, setView] = useState<CalendarView>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sidebarOpen, setSidebarOpen] = useState(isDesktop);
  
  // Deep-link handling: highlighted event ID and refs for scrolling
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const eventRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const debugLoggedEventIds = useRef<Set<string>>(new Set());

  // Calendar list and selection
  const { calendars: googleCalendars, loading: calendarsLoading } = useCalendarList({ userId, enabled: !!userId });
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [calendarPrefsLoaded, setCalendarPrefsLoaded] = useState(false);
  const [primarySelectionExplicit, setPrimarySelectionExplicit] = useState(false);
  const userModifiedSelectionRef = useRef(false);
  const saveCalendarPrefsTimerRef = useRef<number | null>(null);

  // Add Gig Job Orders calendar to the list
  const calendars = useMemo(() => {
    const gigCalendar = getGigJobOrdersCalendarSummary();
    return [...(googleCalendars || []), gigCalendar as CalendarSummary];
  }, [googleCalendars]);

  const primaryCalendarId = useMemo(() => {
    if (!calendars || calendars.length === 0) return '';
    return calendars.find((c) => c.isPrimary)?.id || calendars[0]?.id || '';
  }, [calendars]);

  const primaryCalendar = useMemo(() => {
    if (!primaryCalendarId) return null;
    return (calendars || []).find((c) => c.id === primaryCalendarId) || null;
  }, [calendars, primaryCalendarId]);

  const isOwnCalendar = useCallback(
    (calendar: any) => {
      const id = String(calendar?.id || '').toLowerCase();
      const summary = String(calendar?.summary || '').toLowerCase();
      // Treat primary (and any calendar that is literally the user's email) as "own"
      return !!calendar?.isPrimary || (userEmail && (id === userEmail || summary === userEmail));
    },
    [userEmail]
  );

  const visibleCalendars = useMemo(() => {
    // Hide "own" calendars from the list to prevent duplicates (your primary calendar is always shown on the grid)
    return (calendars || []).filter((c) => !isOwnCalendar(c));
  }, [calendars, isOwnCalendar]);

  // Event modal state
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventModalMode, setEventModalMode] = useState<'create' | 'edit'>('create');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createEventDate, setCreateEventDate] = useState<Date | undefined>(undefined);

  // Calculate date range for current view
  const dateRange = useMemo(() => getCalendarRange(view, currentDate), [view, currentDate]);

  // Check if Gig Job Orders calendar is selected
  const isGigJobOrdersSelected = selectedCalendarIds.has('gig-job-orders');
  
  // Check if Gig Job Orders feature is disabled due to Firestore errors
  const gigJobOrdersDisabled = React.useMemo(() => {
    if (!tenantId) return false;
    return !!sessionStorage.getItem(`firestore_error_${tenantId}`);
  }, [tenantId]);

  // Fetch events for selected calendars and date range
  const selectedGoogleCalendarIds = useMemo(() => {
    return Array.from(selectedCalendarIds).filter((id) => id && id !== 'gig-job-orders');
  }, [selectedCalendarIds]);

  const { events: googleEvents, loading: eventsLoading, refetch: refetchEvents } = useCalendarEvents({
    userId,
    calendarIds: selectedGoogleCalendarIds,
    timeMin: dateRange.start,
    timeMax: dateRange.end,
    enabled: selectedGoogleCalendarIds.length > 0 && !!userId,
  });

  // Live overlay: subscribe to `tenants/{tenantId}/calendar_events` which is
  // populated by the onCalendarPush webhook + renewCalendarWatches scheduler.
  // When a user has push sync enabled, Google fires a notification and we
  // upsert the latest event state into Firestore — this listener picks that
  // up within ~1s, which then overlays onto the API-fetched set below. Safe
  // to keep running when push is off: the array-contains filter on
  // participantUserIds means users without push just see empty snapshots.
  const { events: realtimeEvents } = useCalendarRealtime({
    tenantId,
    userId,
    calendarIds: selectedGoogleCalendarIds,
    timeMin: dateRange.start,
    timeMax: dateRange.end,
    enabled: !!tenantId && !!userId && selectedGoogleCalendarIds.length > 0,
  });

  // Fetch Gig job orders as calendar events (only if not disabled)
  const { events: gigJobOrderEvents, loading: gigJobOrdersLoading } = useGigJobOrdersCalendar({
    tenantId,
    timeMin: dateRange.start,
    timeMax: dateRange.end,
    enabled: isGigJobOrdersSelected && !!tenantId && !gigJobOrdersDisabled,
  });

  // Merge Google (API) + realtime (Firestore push) events.
  //
  // Strategy: keyed by `${calendarId}::${id}`, the realtime version wins
  // because it reflects the most recent push from Google (the API fetch
  // is a snapshot from the last refetch). We preserve the API event's
  // richer metadata (e.g. `hrx`, `creator`) by shallow-merging rather than
  // wholesale replacing — realtime fields overwrite, API-only fields stay.
  const mergedGoogleEvents = useMemo(() => {
    if (realtimeEvents.length === 0) return googleEvents;

    const makeKey = (e: CalendarEvent) => `${e.calendarId}::${e.id}`;
    const byKey = new Map<string, CalendarEvent>();
    for (const e of googleEvents) {
      byKey.set(makeKey(e), e);
    }
    for (const rt of realtimeEvents) {
      const key = makeKey(rt);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, rt);
        continue;
      }
      // Prefer realtime only if it's fresher (or equal — string compare on
      // ISO timestamps is monotonic). This avoids clobbering a just-created
      // API event that has fields the Firestore mirror doesn't yet carry.
      const apiUpdated = existing.updatedAt || '';
      const rtUpdated = rt.updatedAt || '';
      if (rtUpdated >= apiUpdated) {
        byKey.set(key, { ...existing, ...rt, hrx: existing.hrx || rt.hrx });
      }
    }
    return Array.from(byKey.values());
  }, [googleEvents, realtimeEvents]);

  // Merge all events
  const events = useMemo(() => {
    return [...mergedGoogleEvents, ...gigJobOrderEvents];
  }, [mergedGoogleEvents, gigJobOrderEvents]);

  // Load persisted calendar subscriptions from the user doc
  useEffect(() => {
    let cancelled = false;
    async function loadPrefs() {
      if (!userId) return;
      try {
        const snap = await getDoc(doc(db, 'users', userId));
        const data = snap.data() as any;
        const saved = (data?.calendarSettings?.subscribedCalendarIds || []) as string[];
        const explicit = !!data?.calendarSettings?.primarySelectionExplicit;
        if (!cancelled) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Calendar prefs] loaded', { saved, explicit });
          }
          // If the user has already changed selection this session, don't overwrite it
          // with a late-arriving Firestore read.
          if (!userModifiedSelectionRef.current) {
            // We defer applying until calendars have loaded so we can normalize IDs safely.
            setSelectedCalendarIds(new Set(saved.filter(Boolean)));
            setPrimarySelectionExplicit(explicit);
          }
          setCalendarPrefsLoaded(true);
        }
      } catch (e) {
        console.warn('CalendarPage: failed to load calendar subscriptions', e);
        if (!cancelled) {
          setCalendarPrefsLoaded(true);
        }
      }
    }
    void loadPrefs();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persistCalendarPrefs = useCallback(
    (nextSelected: Set<string>) => {
      if (!userId) return;
      // Debounce rapid toggles
      if (saveCalendarPrefsTimerRef.current) {
        window.clearTimeout(saveCalendarPrefsTimerRef.current);
      }
      saveCalendarPrefsTimerRef.current = window.setTimeout(() => {
        const toSave = Array.from(nextSelected).filter(Boolean).sort();
        void (async () => {
          try {
            await setDoc(
              doc(db, 'users', userId),
              { calendarSettings: { subscribedCalendarIds: toSave, primarySelectionExplicit: true } },
              { merge: true }
            );
            if (process.env.NODE_ENV !== 'production') {
              console.log('[Calendar prefs] saved', { toSave });
            }
          } catch (e: any) {
            if (
              e?.message?.includes('INTERNAL ASSERTION') ||
              e?.message?.includes('Unexpected state') ||
              e?.message?.includes('FIRESTORE')
            ) {
              console.warn('CalendarPage: Firestore internal error when persisting subscriptions, skipping');
              return;
            }
            console.warn('CalendarPage: failed to persist calendar subscriptions', e);
          }
        })();
      }, 250);
    },
    [userId]
  );

  // Normalize selection once calendars are loaded, always include primary, and avoid duplicate "own" calendar IDs
  useEffect(() => {
    if (!calendarPrefsLoaded) return;
    // Wait until calendars have actually loaded; otherwise we'd "clean" out valid IDs
    // that simply aren't in the list yet (and end up saving only gig-job-orders).
    if (calendarsLoading) return;
    if (!calendars || calendars.length === 0) return;
    if (!primaryCalendarId) return;

    setSelectedCalendarIds((prev) => {
      const raw = Array.from(prev);

      // Normalize legacy 'primary' token and email-as-id to the actual primary calendar ID
      const normalized = raw.map((id) => {
        const lower = String(id || '').toLowerCase();
        if (lower === 'primary') return primaryCalendarId;
        if (userEmail && lower === userEmail) return primaryCalendarId;
        return id;
      });

      // Keep only calendars that exist
      const validIds = new Set((calendars || []).map((c) => c.id));
      const cleaned = normalized.filter((id) => id && validIds.has(id));

      // Back-compat: historically primary was always implied and not stored.
      // If the user has not explicitly configured primary selection, keep it enabled.
      const next = new Set<string>(cleaned);
      if (!primarySelectionExplicit) {
        next.add(primaryCalendarId);
      }

      // If nothing selected at all, default to primary to avoid an empty calendar.
      if (next.size === 0) {
        next.add(primaryCalendarId);
      }
      return next;
    });
  }, [calendarPrefsLoaded, calendarsLoading, calendars, primaryCalendarId, userEmail, primarySelectionExplicit]);

  // Persist subscriptions (including primary so it can be toggled off)
  useEffect(() => {
    if (!userId) return;
    // Avoid wiping prefs on initial mount before we load them.
    // But if the user toggles any checkbox, persist immediately.
    if (!calendarPrefsLoaded && !userModifiedSelectionRef.current) return;
    // Also avoid auto-saving right after load/normalize unless the user actually changed something.
    if (!userModifiedSelectionRef.current) return;
    persistCalendarPrefs(selectedCalendarIds);
  }, [calendarPrefsLoaded, userId, selectedCalendarIds]);

  // Helper to calculate relative luminance (for contrast checking)
  const getLuminance = useCallback((hex: string): number => {
    // Remove # if present
    const rgb = hex.replace('#', '');
    const r = parseInt(rgb.substring(0, 2), 16) / 255;
    const g = parseInt(rgb.substring(2, 4), 16) / 255;
    const b = parseInt(rgb.substring(4, 6), 16) / 255;
    
    // Apply gamma correction
    const [rLin, gLin, bLin] = [r, g, b].map(val => 
      val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
    );
    
    // Calculate relative luminance
    return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
  }, []);

  // Helper to darken a color to ensure minimum contrast with white text
  const ensureMinimumDarkness = useCallback((hex: string, minLuminance = 0.3): string => {
    const luminance = getLuminance(hex);
    
    // If color is already dark enough, return as-is
    if (luminance <= minLuminance) {
      return hex;
    }
    
    // Darken the color by reducing RGB values proportionally
    const rgb = hex.replace('#', '');
    let r = parseInt(rgb.substring(0, 2), 16);
    let g = parseInt(rgb.substring(2, 4), 16);
    let b = parseInt(rgb.substring(4, 6), 16);
    
    // Calculate how much to darken (target luminance ratio)
    const darkenFactor = minLuminance / luminance;
    
    // Apply darkening
    r = Math.max(0, Math.floor(r * darkenFactor));
    g = Math.max(0, Math.floor(g * darkenFactor));
    b = Math.max(0, Math.floor(b * darkenFactor));
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }, [getLuminance]);

  // Helper to convert event dateTime to local timezone Date
  // This matches the exact logic used in EventModal for consistency
  const getEventLocalDate = useCallback((event: CalendarEvent, useStart = true): Date | null => {
    const dateTimeStr = useStart
      ? (event.start.dateTime || event.start.date)
      : (event.end.dateTime || event.end.date);
    if (!dateTimeStr) return null;
    
    // For all-day events (date only, no time) - match EventModal logic
    if (dateTimeStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return new Date(dateTimeStr + 'T00:00:00');
    }
    
    // Parse exactly the same way as the modal does:
    // `parseISO()` returns a Date for the instant; `getHours()` etc. reflect the viewer's local timezone.
    let parsed = parseISO(dateTimeStr);
    
    // If parseISO failed or the date is invalid, try alternative parsing
    if (!isValidDate(parsed)) {
      // Try standard Date constructor as fallback
      parsed = new Date(dateTimeStr);
    }
    
    // Ensure we have a valid date
    if (!isValidDate(parsed)) {
      console.warn('Failed to parse event dateTime:', dateTimeStr, event);
      return null;
    }
    
    return parsed;
  }, []);

  type EventLayout = {
    col: number;
    colCount: number;
  };

  const getTimedEventRangeMinutes = useCallback(
    (event: CalendarEvent): { start: number; end: number } | null => {
      const startDate = getEventLocalDate(event, true);
      if (!startDate) return null;
      const endDate = getEventLocalDate(event, false) || startDate;

      const start = startDate.getHours() * 60 + startDate.getMinutes();
      let end = endDate.getHours() * 60 + endDate.getMinutes();

      // Guard against weird/zero/negative durations (and same-minute events)
      if (!Number.isFinite(end) || end <= start) end = start + 30;

      // Clamp into the day
      return {
        start: Math.max(0, Math.min(24 * 60, start)),
        end: Math.max(0, Math.min(24 * 60, end)),
      };
    },
    [getEventLocalDate]
  );

  const layoutOverlappingTimedEvents = useCallback(
    (timedEventsForDay: CalendarEvent[]): Map<string, EventLayout> => {
      const items = timedEventsForDay
        .map((event) => {
          const range = getTimedEventRangeMinutes(event);
          if (!range) return null;
          return { event, ...range };
        })
        .filter(
          (x): x is { event: CalendarEvent; start: number; end: number } => x !== null
        )
        .sort((a, b) => (a.start - b.start) || (b.end - a.end));

      // Partition into overlap clusters (transitive overlaps)
      const clusters: Array<Array<{ event: CalendarEvent; start: number; end: number }>> = [];
      let current: Array<{ event: CalendarEvent; start: number; end: number }> = [];
      let currentMaxEnd = -Infinity;

      for (const item of items) {
        if (current.length === 0) {
          current = [item];
          currentMaxEnd = item.end;
          continue;
        }

        if (item.start < currentMaxEnd) {
          current.push(item);
          currentMaxEnd = Math.max(currentMaxEnd, item.end);
        } else {
          clusters.push(current);
          current = [item];
          currentMaxEnd = item.end;
        }
      }
      if (current.length > 0) clusters.push(current);

      const result = new Map<string, EventLayout>();

      for (const cluster of clusters) {
        // Greedy column assignment
        type Active = { end: number; col: number };
        const active: Active[] = [];
        const assignedCols: Array<{ id: string; col: number }> = [];
        let maxCol = -1;

        for (const item of cluster) {
          // Remove ended
          for (let i = active.length - 1; i >= 0; i--) {
            if (active[i].end <= item.start) active.splice(i, 1);
          }

          const used = new Set(active.map((a) => a.col));
          let col = 0;
          while (used.has(col)) col++;

          active.push({ end: item.end, col });
          assignedCols.push({ id: item.event.id, col });
          maxCol = Math.max(maxCol, col);
        }

        const colCount = Math.max(1, maxCol + 1);
        for (const a of assignedCols) {
          result.set(a.id, { col: a.col, colCount });
        }
      }

      return result;
    },
    [getTimedEventRangeMinutes]
  );

  // Helper to get event color from calendar
  const getEventColor = useCallback((event: CalendarEvent) => {
    let backgroundColor: string;
    
    // For Gig job order shifts, use the color based on jobOrderId (stored in colorId)
    if (event.calendarId === 'gig-job-orders' && event.colorId) {
      backgroundColor = getColorForJobOrderId(event.colorId);
    } else {
      // For regular calendar events, use the calendar's color
      const eventCalendar = calendars.find((c) => c.id === event.calendarId);
      backgroundColor = eventCalendar?.backgroundColor || '#1976d2';
    }
    
    // Ensure minimum darkness for readability with white text
    backgroundColor = ensureMinimumDarkness(backgroundColor, 0.3);
    
    return {
      backgroundColor,
      foregroundColor: '#ffffff',
    };
  }, [calendars, ensureMinimumDarkness, getColorForJobOrderId]);

  // Toggle calendar visibility
  const toggleCalendar = useCallback((calendarId: string) => {
    userModifiedSelectionRef.current = true;
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      persistCalendarPrefs(next);
      return next;
    });
  }, [persistCalendarPrefs]);

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
    // DEV-only diagnostics for timezone mismatches (prints once per event id)
    if (process.env.NODE_ENV !== 'production' && !debugLoggedEventIds.current.has(event.id)) {
      debugLoggedEventIds.current.add(event.id);
      try {
        const startStr = event.start?.dateTime || event.start?.date;
        const endStr = event.end?.dateTime || event.end?.date;
        const startParsed = startStr ? parseISO(startStr) : null;
        const endParsed = endStr ? parseISO(endStr) : null;
        console.log('[Calendar debug] openEditModal event', {
          id: event.id,
          summary: event.summary,
          calendarId: event.calendarId,
          start: event.start,
          end: event.end,
          startStr,
          endStr,
          startParsed: startParsed ? startParsed.toString() : null,
          endParsed: endParsed ? endParsed.toString() : null,
          startHHmm: startParsed && isValidDate(startParsed) ? format(startParsed, 'HH:mm') : null,
          endHHmm: endParsed && isValidDate(endParsed) ? format(endParsed, 'HH:mm') : null,
        });
      } catch (e) {
        console.log('[Calendar debug] openEditModal event (failed to log)', e);
      }
    }

    // If it's a Gig job order shift event, navigate to the job order instead
    if (event.calendarId === 'gig-job-orders') {
      if (event.id.startsWith('gig-job-order-estimated-')) {
        const jobOrderId =
          event.colorId || event.hrx?.gigJobOrderId || event.id.replace('gig-job-order-estimated-', '');
        if (jobOrderId) {
          navigate(`/jobs/job-orders/${jobOrderId}`);
          return;
        }
      }
      if (event.id.startsWith('gig-shift-')) {
        // Extract jobOrderId from event ID: gig-shift-{jobOrderId}-{shiftId}
        const parts = event.id.replace('gig-shift-', '').split('-');
        if (parts.length >= 1) {
          // The jobOrderId is everything except the last part (shiftId)
          // But actually, jobOrderId might contain dashes, so we need a better approach
          // Use colorId which we stored with the jobOrderId
          if (event.colorId) {
            navigate(`/jobs/job-orders/${event.colorId}`);
            return;
          }
        }
      } else if (event.id.startsWith('gig-job-order-')) {
        // Legacy: old job order events
        const jobOrderId = event.id.replace('gig-job-order-', '');
        navigate(`/jobs/job-orders/${jobOrderId}`);
        return;
      }
    }
    
    setSelectedEvent(event);
    setEventModalMode('edit');
    setEventModalOpen(true);
  };

  const handleEventSaved = () => {
    setEventModalOpen(false);
    refetchEvents();
  };

  // Combined loading state
  const combinedLoading = eventsLoading || gigJobOrdersLoading;

  // Get upcoming events for sidebar (next 5-10 events)
  const upcomingEvents = useMemo(() => {
    const now = new Date();
    return events
      .filter((event) => {
        const startDate = getEventLocalDate(event, true);
        if (!startDate) return false;
        return startDate >= now;
      })
      .sort((a, b) => {
        const aStart = getEventLocalDate(a, true) || new Date(0);
        const bStart = getEventLocalDate(b, true) || new Date(0);
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
        const startDate = getEventLocalDate(event, true);
        if (!startDate) return false;
        return isSameDay(startDate, day);
      });
    },
    [events, getEventLocalDate]
  );

  // Render month view (simplest, start with this)
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

    // Multi-day event logic (render as spanning bars like Google Calendar)
    const getEventSpanDays = (event: CalendarEvent): { startDay: Date; endDay: Date } | null => {
      const start = getEventLocalDate(event, true);
      if (!start) return null;
      const end = getEventLocalDate(event, false) || start;

      // Treat end as exclusive for day-span calculations (Google style),
      // so an all-day event with end at next midnight is still 1 day.
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

    // For gig multi-day shifts, we render a single spanning "range bar" event.
    // Hide the per-day child occurrences in month view to avoid duplicates.
    const gigMultiDayShiftIds = new Set(
      multiDayEvents
        .filter((e) => e.calendarId === 'gig-job-orders' && e.hrx?.gigShiftRange && e.hrx?.gigShiftId)
        .map((e) => e.hrx!.gigShiftId as string),
    );

    const weeks: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      weeks.push(calendarDays.slice(i, i + 7));
    }

    return (
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        {/* Day headers */}
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
                minWidth: 0, // prevent long content from widening columns
              }}
            >
              {day}
            </Box>
          ))}
        </Box>

        {/* Weeks */}
        {weeks.map((weekDays, weekIndex) => {
          const weekStart = weekDays[0];
          const weekEnd = weekDays[6];

          // Build multi-day segments for this week, clipped to week boundaries
          type Segment = {
            event: CalendarEvent;
            startIdx: number; // 0-6
            endIdx: number; // 0-6 inclusive
            row: number;
          };

          const rawSegments: Omit<Segment, 'row'>[] = [];
          for (const event of multiDayEvents) {
            const span = getEventSpanDays(event);
            if (!span) continue;
            if (span.endDay < weekStart || span.startDay > weekEnd) continue;

            const segStartDay = span.startDay < weekStart ? weekStart : span.startDay;
            const segEndDay = span.endDay > weekEnd ? weekEnd : span.endDay;
            const startIdx = Math.max(0, Math.min(6, differenceInCalendarDays(segStartDay, weekStart)));
            const endIdx = Math.max(0, Math.min(6, differenceInCalendarDays(segEndDay, weekStart)));
            rawSegments.push({ event, startIdx, endIdx });
          }

          rawSegments.sort((a, b) => (a.startIdx - b.startIdx) || ((b.endIdx - b.startIdx) - (a.endIdx - a.startIdx)));

          const rowEnds: number[] = [];
          const segments: Segment[] = [];
          for (const seg of rawSegments) {
            let row = 0;
            while (row < rowEnds.length && rowEnds[row] >= seg.startIdx) row++;
            if (row === rowEnds.length) rowEnds.push(seg.endIdx);
            else rowEnds[row] = seg.endIdx;
            segments.push({ ...seg, row });
          }

          const dayHeaderHeight = 22; // px
          const barHeight = 18; // px
          const barGap = 4; // px
          const barsTop = dayHeaderHeight + 4; // px
          const stripHeight = rowEnds.length > 0 ? (rowEnds.length * barHeight + Math.max(0, rowEnds.length - 1) * barGap + 8) : 0;

          return (
            <Box
              key={`week-${weekIndex}-${weekStart.toISOString()}`}
              sx={{
                position: 'relative',
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                borderBottom: weekIndex === weeks.length - 1 ? 'none' : '1px solid',
                borderColor: 'divider',
                minWidth: 0,
              }}
            >
              {/* Multi-day overlay bars */}
              {segments.length > 0 && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: `${barsTop}px`,
                    left: 0,
                    right: 0,
                    px: 1,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                    gridAutoRows: `${barHeight}px`,
                    rowGap: `${barGap}px`,
                    pointerEvents: 'none',
                    zIndex: 2,
                    minWidth: 0,
                  }}
                >
                  {segments.map((seg) => {
                    const eventColor = getEventColor(seg.event);
                    const tooltipContent = renderShiftTooltip(seg.event);
                    const bar = (
                      <Box
                        key={`seg-${seg.event.id}-${seg.startIdx}-${seg.endIdx}-${seg.row}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEditModal(seg.event);
                        }}
                        sx={{
                          gridColumn: `${seg.startIdx + 1} / ${seg.endIdx + 2}`,
                          gridRow: `${seg.row + 1}`,
                          mx: 0.5,
                          px: 1,
                          display: 'flex',
                          alignItems: 'center',
                          bgcolor: eventColor.backgroundColor,
                          // Always white so the shift name reads cleanly across all bar colors.
                          color: '#ffffff',
                          borderRadius: 0.5,
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          pointerEvents: 'auto',
                          minWidth: 0, // allow ellipsis instead of widening grid column
                          boxShadow:
                            seg.event.id === highlightedEventId ? '0 0 0 2px rgba(59, 130, 246, 0.9)' : 'none',
                          '&:hover': { opacity: 0.9 },
                        }}
                      >
                        {seg.event.summary}
                      </Box>
                    );
                    if (!tooltipContent) return bar;
                    return (
                      <Tooltip
                        key={`seg-${seg.event.id}-${seg.startIdx}-${seg.endIdx}-${seg.row}`}
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

              {/* Day cells */}
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
                    // Keep the range bar (multi-day), but hide child occurrences.
                    if (e.hrx?.gigShiftRange) return true;
                    return !gigMultiDayShiftIds.has(gigShiftId);
                  });

                return (
                  <Box
                    key={day.toISOString()}
                    onClick={() => openCreateModal(day)}
                    sx={{
                      minHeight: 120,
                      p: 1,
                      borderRight: '1px solid',
                      borderColor: 'divider',
                      bgcolor: isCurrentMonth ? 'background.paper' : 'grey.50',
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                      position: 'relative',
                      minWidth: 0, // keep equal column widths
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{
                        height: `${dayHeaderHeight}px`,
                        lineHeight: `${dayHeaderHeight}px`,
                        fontWeight: isTodayDate ? 700 : 400,
                        color: isTodayDate ? 'primary.main' : isCurrentMonth ? 'text.primary' : 'text.disabled',
                        mb: 0,
                      }}
                    >
                      {format(day, 'd')}
                    </Typography>

                    {/* Reserve space for multi-day bars so per-day events don't overlap */}
                    {stripHeight > 0 && <Box sx={{ height: `${stripHeight}px` }} />}

                    {/* Single-day event chips */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 0.5 }}>
                      {dayEvents.slice(0, 3).map((event) => {
                        const eventColor = getEventColor(event);
                        const tooltipContent = renderShiftTooltip(event);
                        const chip = (
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
                              bgcolor: eventColor.backgroundColor,
                              // Always white so the shift name reads cleanly across all chip colors.
                              color: '#ffffff',
                              borderRadius: 0.5,
                              fontSize: '0.75rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              boxShadow:
                                event.id === highlightedEventId ? '0 0 0 2px rgba(59, 130, 246, 0.9)' : 'none',
                              transition: 'box-shadow 0.2s ease-in-out',
                              '&:hover': { opacity: 0.9, transform: 'scale(1.02)' },
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
  };

  // Render week view
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM

    // Get all-day events for the week
    // (Hide gig multi-day range bars here; month view renders them spanning correctly.)
    const allDayEvents = events.filter((event) => event.isAllDay && !event.hrx?.gigShiftRange);

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
                const startDate = getEventLocalDate(event, true);
                if (!startDate) return false;
                return isSameDay(startDate, day);
              });

              return (
                <Box key={day.toISOString()} sx={{ flex: 1, borderRight: '1px solid', borderColor: 'divider', p: 0.5 }}>
                  {dayAllDayEvents.map((event) => {
                    const eventColor = getEventColor(event);
                    return (
                      <Box
                        key={event.id}
                        onClick={() => openEditModal(event)}
                        sx={{
                          px: 1,
                          py: 0.5,
                          mb: 0.5,
                          bgcolor: eventColor.backgroundColor,
                          color: '#ffffff', // Always use white text in week view
                          borderRadius: 0.5,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          '&:hover': { opacity: 0.9, transform: 'scale(1.02)' },
                        }}
                      >
                        <Typography variant="caption" sx={{ color: '#ffffff' }}>
                          {event.summary}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        )}

        {/* Day headers */}
        <Box sx={{ display: 'flex', borderBottom: '2px solid', borderColor: 'divider' }}>
          <Box sx={{ width: 60, flexShrink: 0 }} /> {/* Spacer for hour labels */}
          {weekDays.map((day) => {
            const isTodayDate = isToday(day);
            return (
              <Box
                key={day.toISOString()}
                sx={{
                  flex: 1,
                  minWidth: 0, // prevent content from widening a column
                  borderRight: '1px solid',
                  borderColor: 'divider',
                  p: 1,
                  textAlign: 'center',
                  bgcolor: isTodayDate ? 'action.selected' : 'background.paper',
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {format(day, 'EEE')}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: isTodayDate ? 700 : 400,
                    color: isTodayDate ? 'primary.main' : 'text.primary',
                  }}
                >
                  {format(day, 'd')}
                </Typography>
              </Box>
            );
          })}
        </Box>

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
              const startDate = getEventLocalDate(event, true);
              if (!startDate) return false;
              return isSameDay(startDate, day);
            });
            const dayLayout = layoutOverlappingTimedEvents(dayTimedEvents);

            return (
              <Box
                key={day.toISOString()}
                sx={{
                  flex: 1,
                  minWidth: 0, // lock equal day widths
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
                  const startDate = getEventLocalDate(event, true);
                  if (!startDate) return null;
                  const endDate = getEventLocalDate(event, false) || startDate;

                  const startHour = startDate.getHours() + startDate.getMinutes() / 60;
                  const endHour = endDate.getHours() + endDate.getMinutes() / 60;
                  const durationMinutes = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

                  // Show events that overlap with visible hours (6 AM - 11 PM)
                  // Include events that start before 6 AM but end after 6 AM
                  // Include events that start before 11 PM (even if they end after)
                  if (endHour < 6 || startHour >= 24) return null;

                  // Use pixel-perfect positioning to match the 60px/hour grid exactly.
                  const topPx = Math.max(0, (startHour - 6) * 60);
                  const heightPx = Math.max(20, (durationMinutes / 60) * 60);
                  const eventColor = getEventColor(event);
                  const layout = dayLayout.get(event.id) || { col: 0, colCount: 1 };
                  const widthPct = 100 / layout.colCount;
                  const leftPct = layout.col * widthPct;

                  return (
                    <Box
                      key={event.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModal(event);
                      }}
                      sx={{
                        position: 'absolute',
                        top: `${topPx}px`,
                        left: `calc(${leftPct}% + 4px)`,
                        width: `calc(${widthPct}% - 8px)`,
                        height: `${heightPx}px`,
                        minHeight: 20,
                        bgcolor: eventColor.backgroundColor,
                        color: '#ffffff', // Always use white text in week view
                        borderRadius: 0.5,
                        p: 0.5,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        zIndex: 1,
                        '&:hover': { opacity: 0.9, zIndex: 2 },
                      }}
                    >
                    <Typography variant="caption" fontWeight={600} noWrap sx={{ color: '#ffffff' }}>
                      {event.summary}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.9, color: '#ffffff' }}>
                      {(() => {
                        const localStart = getEventLocalDate(event, true);
                        const localEnd = getEventLocalDate(event, false);
                        if (!localStart) return '';
                        if (!localEnd) return format(localStart, 'h:mm a');
                        return `${format(localStart, 'h:mm a')} - ${format(localEnd, 'h:mm a')}`;
                      })()}
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
    const dayEvents = getEventsForDay(currentDate);
    const allDayEvents = dayEvents.filter(
      (event) => event.isAllDay && !event.hrx?.gigShiftRange && !event.hrx?.gigJobOrderRange
    );
    const timedEvents = dayEvents.filter((event) => !event.isAllDay);
    const dayLayout = layoutOverlappingTimedEvents(timedEvents);
    
    // Calculate the time range needed to show all events
    // Find the earliest and latest event times
    let minHour = 6; // Default start
    let maxHour = 23; // Default end
    
    if (timedEvents.length > 0) {
      const eventHours = timedEvents
        .map((event) => {
          const startDate = getEventLocalDate(event, true);
          const endDate = getEventLocalDate(event, false);
          if (!startDate) return null;
          return {
            startHour: startDate.getHours() + startDate.getMinutes() / 60,
            endHour: endDate ? (endDate.getHours() + endDate.getMinutes() / 60) : (startDate.getHours() + startDate.getMinutes() / 60 + 1),
          };
        })
        .filter((h): h is { startHour: number; endHour: number } => h !== null);
      
      if (eventHours.length > 0) {
        minHour = Math.min(6, Math.floor(Math.min(...eventHours.map(h => h.startHour))));
        maxHour = Math.max(23, Math.ceil(Math.max(...eventHours.map(h => h.endHour))));
        // Ensure we have at least 6 AM to 11 PM visible
        minHour = Math.min(minHour, 6);
        maxHour = Math.max(maxHour, 23);
      }
    }
    
    // Generate hours array based on the range needed
    const hours = Array.from({ length: maxHour - minHour + 1 }, (_, i) => i + minHour);

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
            {allDayEvents.map((event) => {
              const eventColor = getEventColor(event);
              const tooltipContent = renderShiftTooltip(event);
              const chip = (
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
                    bgcolor: eventColor.backgroundColor,
                    color: '#ffffff',
                    borderRadius: 0.5,
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    boxShadow: event.id === highlightedEventId 
                      ? '0 0 0 2px rgba(59, 130, 246, 0.9)' 
                      : 'none',
                    transition: 'box-shadow 0.2s ease-in-out',
                    '&:hover': { opacity: 0.9, transform: 'scale(1.02)' },
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
              const startDate = getEventLocalDate(event, true);
              if (!startDate) return null;
              const endDate = getEventLocalDate(event, false) || startDate;

              const startHour = startDate.getHours() + startDate.getMinutes() / 60;
              const endHour = endDate.getHours() + endDate.getMinutes() / 60;
              const durationMinutes = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

              // Show all events for the day - calculate position based on visible hour range
              // Use pixel-perfect positioning to match the 60px/hour grid exactly.
              const topPx = Math.max(0, (startHour - minHour) * 60);
              const heightPx = Math.max(32, (durationMinutes / 60) * 60);
              const eventColor = getEventColor(event);
              const layout = dayLayout.get(event.id) || { col: 0, colCount: 1 };
              const widthPct = 100 / layout.colCount;
              const leftPct = layout.col * widthPct;

              // DEV-only diagnostics for timezone mismatches (prints once per event id)
              if (process.env.NODE_ENV !== 'production' && !debugLoggedEventIds.current.has(`day-${event.id}`)) {
                debugLoggedEventIds.current.add(`day-${event.id}`);
                try {
                  const startStr = event.start?.dateTime || event.start?.date;
                  const endStr = event.end?.dateTime || event.end?.date;
                  console.log('[Calendar debug] day block placement', {
                    id: event.id,
                    summary: event.summary,
                    start: event.start,
                    end: event.end,
                    startStr,
                    endStr,
                    startLocal: startDate.toString(),
                    endLocal: endDate.toString(),
                    startHHmm: format(startDate, 'HH:mm'),
                    endHHmm: format(endDate, 'HH:mm'),
                    minHour,
                    maxHour,
                    startHour,
                    endHour,
                    topPx,
                    heightPx,
                  });
                } catch (e) {
                  console.log('[Calendar debug] day block placement (failed to log)', e);
                }
              }

              const tooltipContent = renderShiftTooltip(event);
              const block = (
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
                    top: `${topPx}px`,
                    left: `calc(${leftPct}% + 8px)`,
                    width: `calc(${widthPct}% - 16px)`,
                    height: `${heightPx}px`,
                    minHeight: 32,
                    bgcolor: eventColor.backgroundColor,
                    color: '#ffffff',
                    borderRadius: 1,
                    p: 1,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    zIndex: 1,
                    boxShadow: event.id === highlightedEventId 
                      ? '0 0 0 3px rgba(59, 130, 246, 0.9)' 
                      : 1,
                    transition: 'box-shadow 0.2s ease-in-out',
                    '&:hover': { opacity: 0.9, zIndex: 2, boxShadow: 2 },
                  }}
                >
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ color: '#ffffff' }}>
                    {event.summary}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.9, color: '#ffffff' }}>
                    {(() => {
                      const localStart = getEventLocalDate(event, true);
                      const localEnd = getEventLocalDate(event, false);
                      if (!localStart) return '';
                      if (!localEnd) return format(localStart, 'h:mm a');
                      return `${format(localStart, 'h:mm a')} - ${format(localEnd, 'h:mm a')}`;
                    })()}
                  </Typography>
                  {event.location && (
                    <Typography variant="caption" sx={{ opacity: 0.8, display: 'block', mt: 0.5, color: '#ffffff' }}>
                      {event.location}
                    </Typography>
                  )}
                </Box>
              );
              return tooltipContent ? (
                <Tooltip
                  key={event.id}
                  title={tooltipContent}
                  arrow
                  placement="top"
                  enterDelay={150}
                >
                  {block}
                </Tooltip>
              ) : (
                block
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
            {primaryCalendar && (
              <ListItem key={primaryCalendar.id} disablePadding>
                <ListItemButton
                  onClick={() => toggleCalendar(primaryCalendar.id)}
                  sx={{ py: 0.5, px: 1 }}
                >
                  <Checkbox
                    edge="start"
                    checked={selectedCalendarIds.has(primaryCalendar.id)}
                    tabIndex={-1}
                    disableRipple
                    size="small"
                  />
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: primaryCalendar.backgroundColor || '#7986cb',
                      mr: 1,
                      flexShrink: 0,
                    }}
                  />
                  <ListItemText
                    primary="My Calendar"
                    primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                  />
                </ListItemButton>
              </ListItem>
            )}
            {visibleCalendars.map((calendar) => (
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
      <Box 
        sx={{ 
          flex: 1, 
          overflow: 'auto', 
          p: 2,
          // Thin, light scrollbar styling per spec
          '&::-webkit-scrollbar': {
            width: '8px',
            height: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'rgba(0, 0, 0, 0.02)',
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(0, 0, 0, 0.15)',
            borderRadius: '4px',
            '&:hover': {
              background: 'rgba(0, 0, 0, 0.25)',
            },
          },
          // Firefox scrollbar styling
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.02)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
          Upcoming
        </Typography>
        {combinedLoading ? (
          <CircularProgress size={20} />
        ) : upcomingEvents.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No upcoming events
          </Typography>
        ) : (
          <List dense>
            {upcomingEvents.map((event) => {
              const startDate = getEventLocalDate(event, true) || new Date();
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
          {/* Date display based on view */}
          <Typography variant="h6" fontWeight={500} sx={{ ml: 2, color: 'text.secondary' }}>
            {view === 'month' && format(currentDate, 'MMMM, yyyy')}
            {view === 'week' && (() => {
              const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
              const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
              return `${format(weekStart, 'EEEE MMM do')} - ${format(weekEnd, 'EEEE MMM do')}`;
            })()}
            {view === 'day' && format(currentDate, 'EEEE, MMMM do')}
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
