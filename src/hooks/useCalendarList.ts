/**
 * useCalendarList Hook
 *
 * Fetches the user's calendar list from Google Calendar API.
 *
 * Caching (2026-05-26): the user's calendar list rarely changes
 * mid-session, so we mirror `useCalendarEvents`'s stale-while-revalidate
 * pattern. On revisit we paint from sessionStorage immediately (no
 * full-page spinner for the sidebar checkboxes) and silently refresh
 * in the background if the cache is older than the threshold.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarSummary } from '../types/calendar';
import { listCalendars } from '../api/calendarApi';

interface UseCalendarListOptions {
  userId: string;
  enabled?: boolean;
}

interface UseCalendarListReturn {
  calendars: CalendarSummary[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

type CalendarListCacheEntryV1 = {
  v: 1;
  fetchedAt: number;
  calendars: CalendarSummary[];
};

const BACKGROUND_REFRESH_MIN_AGE_MS = 60_000;

function safeReadCache(key: string): CalendarListCacheEntryV1 | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalendarListCacheEntryV1;
    if (
      !parsed ||
      parsed.v !== 1 ||
      !Array.isArray(parsed.calendars) ||
      typeof parsed.fetchedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function safeWriteCache(key: string, entry: CalendarListCacheEntryV1): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

/**
 * Hook to fetch calendar list
 *
 * Uses the calendarApi client which currently returns mocked data.
 */
export function useCalendarList({ userId, enabled = true }: UseCalendarListOptions): UseCalendarListReturn {
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const cacheKey = useMemo(
    () => (userId ? `calendarList.v1:${userId}` : null),
    [userId],
  );

  const fetchCalendars = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId || !enabled) {
        setLoading(false);
        return;
      }

      const silent = !!opts?.silent;
      if (!silent) setLoading(true);
      setError(null);

      try {
        const data = await listCalendars(userId);
        setCalendars(data);
        if (cacheKey) {
          safeWriteCache(cacheKey, {
            v: 1,
            fetchedAt: Date.now(),
            calendars: data,
          });
        }
      } catch (err: any) {
        const isExpiredAccess =
          err?.message?.includes('Google Calendar access has expired') ||
          err?.message?.includes('access has expired');
        if (isExpiredAccess) {
          console.warn('Calendar access expired; reconnect Google account to restore calendar list.');
        } else {
          console.error('Error fetching calendar list:', err);
        }
        setError(err instanceof Error ? err : new Error('Failed to fetch calendars'));
        // Don't clear `calendars` on silent revalidation — keep showing
        // the cached list rather than flashing empty.
        if (!silent) setCalendars([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [userId, enabled, cacheKey],
  );

  useEffect(() => {
    if (!userId || !enabled) {
      setLoading(false);
      return;
    }
    const cached = cacheKey ? safeReadCache(cacheKey) : null;
    if (cached) {
      setCalendars(cached.calendars ?? []);
      setLoading(false);
      // Stale-while-revalidate: silently refresh if cache is older
      // than the threshold; skip otherwise.
      if (Date.now() - cached.fetchedAt >= BACKGROUND_REFRESH_MIN_AGE_MS) {
        void fetchCalendars({ silent: true });
      }
      return;
    }
    void fetchCalendars();
  }, [userId, enabled, cacheKey, fetchCalendars]);

  return {
    calendars,
    loading,
    error,
    refetch: () => fetchCalendars(),
  };
}
