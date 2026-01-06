/**
 * useCalendarEvents Hook
 * 
 * Fetches calendar events for a date range and list of calendars.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarEvent, ListCalendarEventsRequest } from '../types/calendar';
import { listEvents } from '../api/calendarApi';

interface UseCalendarEventsOptions {
  userId: string;
  calendarIds: string[];
  timeMin: Date;
  timeMax: Date;
  timeZone?: string;
  syncToken?: string | null;
  enabled?: boolean;
}

interface UseCalendarEventsReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  nextSyncToken?: string;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch calendar events
 * 
 * Uses the calendarApi client which currently returns mocked data.
 */
export function useCalendarEvents({
  userId,
  calendarIds,
  timeMin,
  timeMax,
  timeZone,
  syncToken,
  enabled = true,
}: UseCalendarEventsOptions): UseCalendarEventsReturn {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nextSyncToken, setNextSyncToken] = useState<string | undefined>();

  // Use refs to store the latest values for the refetch function
  const latestParamsRef = useRef({ userId, calendarIds, timeMin, timeMax, timeZone, syncToken, enabled });

  // Update ref on every render
  useEffect(() => {
    latestParamsRef.current = { userId, calendarIds, timeMin, timeMax, timeZone, syncToken, enabled };
  }, [userId, calendarIds, timeMin, timeMax, timeZone, syncToken, enabled]);

  // Convert Date objects and arrays to stable primitives for comparison
  const calendarIdsKey = JSON.stringify([...calendarIds].sort());
  const timeMinKey = timeMin.toISOString();
  const timeMaxKey = timeMax.toISOString();
  const timeZoneKey = timeZone || '';
  const syncTokenKey = syncToken || '';

  const fetchEvents = useCallback(async () => {
    const params = latestParamsRef.current;
    if (!params.userId || !params.enabled || params.calendarIds.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const request: ListCalendarEventsRequest & { userId: string } = {
        userId: params.userId,
        calendarIds: params.calendarIds,
        timeMin: params.timeMin.toISOString(),
        timeMax: params.timeMax.toISOString(),
        timeZone: params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        syncToken: params.syncToken || undefined,
      };

      const data = await listEvents(request);
      setEvents(data.events);
      setNextSyncToken(data.nextSyncToken);
    } catch (err: any) {
      console.error('Error fetching calendar events:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch calendar events'));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []); // Empty deps - uses ref for latest values

  useEffect(() => {
    if (!userId || !enabled || calendarIds.length === 0) {
      setLoading(false);
      return;
    }
    void fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, enabled, calendarIdsKey, timeMinKey, timeMaxKey, timeZoneKey, syncTokenKey]);

  return {
    events,
    loading,
    error,
    nextSyncToken,
    refetch: fetchEvents,
  };
}
