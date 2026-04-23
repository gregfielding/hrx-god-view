/**
 * useCalendarRealtime Hook
 *
 * Firestore listener for the `tenants/{tenantId}/calendar_events` collection,
 * which is populated by the `onCalendarPush` webhook + `renewCalendarWatches`
 * scheduled job. Designed to layer on top of `useCalendarEvents` (which pulls
 * from the Google Calendar API via our `listEvents` callable): the API call
 * gives us the initial paint and handles users who haven't enabled push yet,
 * while this hook streams in live updates the instant Google notifies us.
 *
 * Filters:
 *   - participantUserIds array-contains userId  (matches how calendarPush.ts
 *     stores owners on each event doc)
 *   - start >= timeMin                          (window lower bound)
 *   - orderBy start asc, limit                  (upper bound + status filter
 *                                                are applied client-side; see
 *                                                "Why client-side filtering"
 *                                                note below.)
 *
 * Why client-side filtering for `end` and `status`:
 *   Firestore allows at most one range field per composite query. We already
 *   use `start >=` as the range. Filtering out cancelled events and events
 *   with start > timeMax in memory keeps the query cheap and avoids needing
 *   an additional index.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  collection,
  query,
  where,
  orderBy,
  limit as limitClause,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { CalendarEvent } from '../types/calendar';

export interface UseCalendarRealtimeOptions {
  tenantId: string;
  userId: string;
  /**
   * Optional list of calendar IDs to narrow to. If omitted or empty, events
   * from all of the user's calendars are returned (client-side filter only).
   */
  calendarIds?: string[];
  timeMin: Date;
  timeMax: Date;
  /**
   * Max docs to stream. Defaults to 500 (Firestore's sweet spot for snapshot
   * size). Tune down if month views get chatty.
   */
  limit?: number;
  enabled?: boolean;
}

export interface UseCalendarRealtimeReturn {
  events: CalendarEvent[];
  loading: boolean;
  error: Error | null;
  /** True once at least one snapshot has landed. */
  hasSnapshot: boolean;
}

function normalizeTimestamp(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === 'function') return v.toDate();
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Map a Firestore `calendar_events` doc (as written by calendarPush.ts's
 * `upsertCalendarEvent`) into the `CalendarEvent` shape the rest of the app
 * consumes.
 */
function mapFirestoreDocToCalendarEvent(
  id: string,
  data: DocumentData
): CalendarEvent | null {
  const gcalEventId = (data.gcalEventId as string) || id;
  const calendarId = (data.calendarId as string) || '';
  if (!gcalEventId || !calendarId) return null;

  const start = normalizeTimestamp(data.start);
  const end = normalizeTimestamp(data.end);
  const status = (data.status as CalendarEvent['status']) || 'confirmed';
  const isAllDay = !!data.allDay;

  const createdAt = normalizeTimestamp(data.createdAt) || start || new Date();
  const updatedAt = normalizeTimestamp(data.updatedAt) || createdAt;

  const startField = isAllDay
    ? { date: start ? start.toISOString().slice(0, 10) : undefined }
    : { dateTime: start ? start.toISOString() : undefined };
  const endField = isAllDay
    ? { date: end ? end.toISOString().slice(0, 10) : undefined }
    : { dateTime: end ? end.toISOString() : undefined };

  return {
    id: gcalEventId,
    calendarId,
    status,
    summary: (data.summary as string) || '',
    description: (data.description as string) || '',
    location: (data.location as string) || '',
    start: startField,
    end: endField,
    attendees: Array.isArray(data.attendees)
      ? data.attendees.map((a: any) => ({
          email: (a?.email as string) || '',
          displayName: (a?.displayName as string) || undefined,
          responseStatus: a?.responseStatus || undefined,
          optional: !!a?.optional,
        }))
      : undefined,
    organizer: data.organizerEmail
      ? { email: data.organizerEmail as string }
      : undefined,
    recurrence: Array.isArray(data.recurrence) ? data.recurrence : undefined,
    hangoutLink: (data.hangoutLink as string) || undefined,
    htmlLink: (data.htmlLink as string) || undefined,
    isAllDay,
    // We can't reliably reconstruct "isRecurringInstance" without the raw
    // Google payload; assume false — downstream code only uses this for UI
    // badging.
    isRecurringInstance: !!data.recurringEventId,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

/**
 * Real-time calendar events subscription.
 */
export function useCalendarRealtime(
  options: UseCalendarRealtimeOptions
): UseCalendarRealtimeReturn {
  const {
    tenantId,
    userId,
    calendarIds,
    timeMin,
    timeMax,
    limit = 500,
    enabled = true,
  } = options;

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  // Stable primitives for useEffect deps — Date objects change identity.
  const timeMinMs = timeMin.getTime();
  const timeMaxMs = timeMax.getTime();
  const calendarIdsKey = useMemo(
    () =>
      Array.isArray(calendarIds) && calendarIds.length
        ? [...calendarIds].sort().join(',')
        : '',
    [calendarIds]
  );

  useEffect(() => {
    // Always tear down any prior listener first.
    if (unsubRef.current) {
      try {
        unsubRef.current();
      } catch {
        /* noop */
      }
      unsubRef.current = null;
    }

    if (!enabled || !tenantId || !userId) {
      setEvents([]);
      setLoading(false);
      setHasSnapshot(false);
      return;
    }

    setLoading(true);
    setError(null);

    const eventsRef = collection(db, 'tenants', tenantId, 'calendar_events');

    // Small buffer before timeMin so a week that starts on Sunday still
    // catches a Sat-evening event whose start rounds just below.
    const lowerBoundMs = timeMinMs;

    const q = query(
      eventsRef,
      where('participantUserIds', 'array-contains', userId),
      where('start', '>=', new Date(lowerBoundMs)),
      orderBy('start', 'asc'),
      limitClause(limit)
    );

    try {
      const unsub = onSnapshot(
        q,
        (snap: QuerySnapshot<DocumentData>) => {
          try {
            const selectedIds =
              calendarIdsKey.length > 0 ? new Set(calendarIdsKey.split(',')) : null;

            const next: CalendarEvent[] = [];
            snap.forEach((docSnap) => {
              const data = docSnap.data();
              const mapped = mapFirestoreDocToCalendarEvent(docSnap.id, data);
              if (!mapped) return;
              // Client-side upper-bound filter.
              const startMs = mapped.start?.dateTime
                ? new Date(mapped.start.dateTime).getTime()
                : mapped.start?.date
                  ? new Date(mapped.start.date).getTime()
                  : null;
              if (startMs !== null && startMs > timeMaxMs) return;
              // Hide cancelled events from the live overlay — the API fetch
              // already drops these. Keeping them would cause duplicate
              // "ghost" entries.
              if (mapped.status === 'cancelled') return;
              // Narrow to selected calendars if requested.
              if (selectedIds && !selectedIds.has(mapped.calendarId)) return;
              next.push(mapped);
            });
            setEvents(next);
            setHasSnapshot(true);
            setLoading(false);
            setError(null);
          } catch (err: any) {
            console.error('useCalendarRealtime: snapshot processing failed', err);
            setError(err);
            setLoading(false);
          }
        },
        (err: Error) => {
          console.warn('useCalendarRealtime: snapshot error (non-fatal):', err);
          setError(err);
          setLoading(false);
        }
      );
      unsubRef.current = unsub;
    } catch (err: any) {
      console.error('useCalendarRealtime: failed to attach listener', err);
      setError(err);
      setLoading(false);
    }

    return () => {
      if (unsubRef.current) {
        try {
          unsubRef.current();
        } catch {
          /* noop */
        }
        unsubRef.current = null;
      }
    };
  }, [tenantId, userId, calendarIdsKey, timeMinMs, timeMaxMs, limit, enabled]);

  return {
    events,
    loading,
    error,
    hasSnapshot,
  };
}
