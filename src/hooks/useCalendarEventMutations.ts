/**
 * useCalendarEventMutations Hook
 * 
 * Provides functions to create, update, and delete calendar events.
 */

import { useState, useCallback } from 'react';
import { CalendarEvent, CalendarEventInput } from '../types/calendar';
import { createEvent, updateEvent, deleteEvent as deleteEventApi, rsvpToEvent as rsvpToEventApi } from '../api/calendarApi';

interface UseCalendarEventMutationsReturn {
  createEvent: (calendarId: string, payload: CalendarEventInput) => Promise<CalendarEvent>;
  updateEvent: (calendarId: string, eventId: string, payload: CalendarEventInput) => Promise<CalendarEvent>;
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>;
  rsvpToEvent: (calendarId: string, eventId: string, responseStatus: 'accepted' | 'declined' | 'tentative', userEmail: string) => Promise<CalendarEvent>;
  creating: boolean;
  updating: boolean;
  deleting: boolean;
  rsvping: boolean;
  error: Error | null;
}

/**
 * Hook for calendar event mutations (create, update, delete)
 * 
 * Uses the calendarApi client which currently returns mocked data.
 */
export function useCalendarEventMutations(userId: string): UseCalendarEventMutationsReturn {
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rsvping, setRsvping] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const createEventHandler = useCallback(
    async (calendarId: string, payload: CalendarEventInput): Promise<CalendarEvent> => {
      if (!userId) {
        throw new Error('User ID is required');
      }

      setCreating(true);
      setError(null);

      try {
        return await createEvent(userId, calendarId, payload);
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err : new Error('Failed to create calendar event');
        setError(errorMessage);
        throw errorMessage;
      } finally {
        setCreating(false);
      }
    },
    [userId]
  );

  const updateEventHandler = useCallback(
    async (calendarId: string, eventId: string, payload: CalendarEventInput): Promise<CalendarEvent> => {
      if (!userId) {
        throw new Error('User ID is required');
      }

      setUpdating(true);
      setError(null);

      try {
        return await updateEvent(userId, calendarId, eventId, payload);
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err : new Error('Failed to update calendar event');
        setError(errorMessage);
        throw errorMessage;
      } finally {
        setUpdating(false);
      }
    },
    [userId]
  );

  const deleteEventHandler = useCallback(
    async (calendarId: string, eventId: string): Promise<void> => {
      if (!userId) {
        throw new Error('User ID is required');
      }

      setDeleting(true);
      setError(null);

      try {
        await deleteEventApi(userId, calendarId, eventId);
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err : new Error('Failed to delete calendar event');
        setError(errorMessage);
        throw errorMessage;
      } finally {
        setDeleting(false);
      }
    },
    [userId]
  );

  const rsvpToEventHandler = useCallback(
    async (
      calendarId: string,
      eventId: string,
      responseStatus: 'accepted' | 'declined' | 'tentative',
      userEmail: string
    ): Promise<CalendarEvent> => {
      if (!userId) {
        throw new Error('User ID is required');
      }

      setRsvping(true);
      setError(null);

      try {
        return await rsvpToEventApi(userId, calendarId, eventId, responseStatus, userEmail);
      } catch (err: any) {
        const errorMessage = err instanceof Error ? err : new Error('Failed to RSVP to calendar event');
        setError(errorMessage);
        throw errorMessage;
      } finally {
        setRsvping(false);
      }
    },
    [userId]
  );

  return {
    createEvent: createEventHandler,
    updateEvent: updateEventHandler,
    deleteEvent: deleteEventHandler,
    rsvpToEvent: rsvpToEventHandler,
    creating,
    updating,
    deleting,
    rsvping,
    error,
  };
}

