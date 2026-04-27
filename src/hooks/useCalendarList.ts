/**
 * useCalendarList Hook
 * 
 * Fetches the user's calendar list from Google Calendar API.
 */

import { useState, useEffect } from 'react';
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

/**
 * Hook to fetch calendar list
 * 
 * Uses the calendarApi client which currently returns mocked data.
 */
export function useCalendarList({ userId, enabled = true }: UseCalendarListOptions): UseCalendarListReturn {
  const [calendars, setCalendars] = useState<CalendarSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCalendars = async () => {
    if (!userId || !enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await listCalendars(userId);
      setCalendars(data);
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
      setCalendars([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCalendars();
  }, [userId, enabled]);

  return {
    calendars,
    loading,
    error,
    refetch: fetchCalendars,
  };
}

