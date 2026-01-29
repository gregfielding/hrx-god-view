/**
 * useCalendarEvents Hook
 * 
 * Fetches calendar events for a date range and list of calendars.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarEvent, ListCalendarEventsRequest } from '../types/calendar';
import { listEvents } from '../api/calendarApi';

type CalendarEventsCacheEntryV1 = {
  v: 1;
  fetchedAt: number; // epoch ms
  events: CalendarEvent[];
  nextSyncToken?: string;
};

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

  const buildCacheKey = useCallback((params: typeof latestParamsRef.current) => {
    const tz = params.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const ids = [...(params.calendarIds || [])].filter(Boolean).sort().join(',');
    // v1: scoped to user + calendars + range + tz
    return `calendarEvents.v1:${params.userId}:${ids}:${params.timeMin.toISOString()}:${params.timeMax.toISOString()}:${tz}`;
  }, []);

  const safeReadCache = useCallback((cacheKey: string): CalendarEventsCacheEntryV1 | null => {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CalendarEventsCacheEntryV1;
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.events) || typeof parsed.fetchedAt !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const safeWriteCache = useCallback((cacheKey: string, entry: CalendarEventsCacheEntryV1) => {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
      // ignore quota / serialization issues
    }
  }, []);

  const fetchEvents = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    const params = latestParamsRef.current;
    if (!params.userId || !params.enabled || params.calendarIds.length === 0) {
      // Important: clear stale events when user deselects calendars.
      setEvents([]);
      setNextSyncToken(undefined);
      setLoading(false);
      return;
    }

    const silent = !!opts?.silent;
    if (!silent) {
      setLoading(true);
    }
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
      // Persist to session cache so /calendar can render instantly on reload/back.
      const cacheKey = buildCacheKey(params);
      safeWriteCache(cacheKey, { v: 1, fetchedAt: Date.now(), events: data.events, nextSyncToken: data.nextSyncToken });
    } catch (err: any) {
      console.error('Error fetching calendar events:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch calendar events'));
      // Keep whatever we last had (cached or previous) when doing a silent refresh.
      if (!silent) setEvents([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [buildCacheKey, safeWriteCache]); // uses ref for latest values

  useEffect(() => {
    if (!userId || !enabled || calendarIds.length === 0) {
      // Important: clear stale events when disabled/empty.
      setEvents([]);
      setNextSyncToken(undefined);
      setLoading(false);
      return;
    }
    // Cache-first render (stale-while-revalidate):
    // - If cached, show immediately (no full-page spinner)
    // - Revalidate in the background so new events still load
    const params = latestParamsRef.current;
    const cacheKey = buildCacheKey(params);
    const cached = safeReadCache(cacheKey);
    const now = Date.now();
    const ageMs = cached ? now - cached.fetchedAt : Infinity;
    const BACKGROUND_REFRESH_MIN_AGE_MS = 30_000; // avoid spamming on rapid tab switches

    if (cached) {
      setEvents(cached.events || []);
      setNextSyncToken(cached.nextSyncToken);
      setLoading(false);
      // refresh in background if cache is older than threshold
      if (ageMs >= BACKGROUND_REFRESH_MIN_AGE_MS) {
        void fetchEvents({ silent: true, force: true });
      }
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
    refetch: async () => fetchEvents({ silent: false, force: true }),
  };
}
