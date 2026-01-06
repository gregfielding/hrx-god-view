/**
 * Calendar API Client
 * 
 * Typed functions for calendar operations.
 * Calls Firebase Cloud Functions for real calendar operations.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { CalendarSummary, CalendarEvent, CalendarEventInput, ListCalendarEventsRequest } from '../types/calendar';

const functions = getFunctions();

/**
 * Get list of calendars for the user
 */
export async function listCalendars(userId: string): Promise<CalendarSummary[]> {
  const listCalendarsFn = httpsCallable<{ userId: string }, { calendars: CalendarSummary[] }>(
    functions,
    'listCalendars'
  );
  const response = await listCalendarsFn({ userId });
  return response.data.calendars;
}

/**
 * List calendar events for a date range
 */
export async function listEvents(request: ListCalendarEventsRequest & { userId: string }): Promise<{
  events: CalendarEvent[];
  nextSyncToken?: string;
}> {
  const listEventsFn = httpsCallable<
    { userId: string } & ListCalendarEventsRequest,
    { events: CalendarEvent[]; nextSyncToken?: string }
  >(functions, 'listEvents');
  const response = await listEventsFn(request);
  return response.data;
}

/**
 * Create a new calendar event
 */
export async function createEvent(
  userId: string,
  calendarId: string,
  payload: CalendarEventInput
): Promise<CalendarEvent> {
  const createEventFn = httpsCallable<
    { userId: string; calendarId: string; payload: CalendarEventInput },
    CalendarEvent
  >(functions, 'createEvent');
  const response = await createEventFn({ userId, calendarId, payload });
  return response.data;
}

/**
 * Update an existing calendar event
 */
export async function updateEvent(
  userId: string,
  calendarId: string,
  eventId: string,
  payload: CalendarEventInput
): Promise<CalendarEvent> {
  const updateEventFn = httpsCallable<
    { userId: string; calendarId: string; eventId: string; payload: CalendarEventInput },
    CalendarEvent
  >(functions, 'updateEvent');
  const response = await updateEventFn({ userId, calendarId, eventId, payload });
  return response.data;
}

/**
 * Delete a calendar event
 */
export async function deleteEvent(
  userId: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const deleteEventFn = httpsCallable<{ userId: string; calendarId: string; eventId: string }, { success: boolean }>(
    functions,
    'deleteEvent'
  );
  await deleteEventFn({ userId, calendarId, eventId });
}

/**
 * RSVP to a calendar event (update attendee response status)
 */
export async function rsvpToEvent(
  userId: string,
  calendarId: string,
  eventId: string,
  responseStatus: 'accepted' | 'declined' | 'tentative',
  userEmail: string
): Promise<CalendarEvent> {
  const rsvpToEventFn = httpsCallable<
    { userId: string; calendarId: string; eventId: string; responseStatus: 'accepted' | 'declined' | 'tentative'; userEmail: string },
    CalendarEvent
  >(functions, 'rsvpToEvent');
  const response = await rsvpToEventFn({ userId, calendarId, eventId, responseStatus, userEmail });
  return response.data;
}
