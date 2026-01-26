/**
 * Calendar API Functions
 * 
 * Firebase Cloud Functions for calendar operations.
 * Provides listCalendars, listEvents, createEvent, updateEvent, deleteEvent.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import type {
  CalendarSummary,
  CalendarEvent,
  CalendarEventInput,
  ListCalendarEventsRequest,
} from './types';

const db = getFirestore();

// OAuth configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

/**
 * Get OAuth2 client with user credentials
 */
async function getAuthenticatedCalendarClient(userId: string) {
  const userDoc = await db.collection('users').doc(userId).get();
  
  if (!userDoc.exists) {
    throw new HttpsError('not-found', 'User not found');
  }

  const userData = userDoc.data();
  
  if (!userData?.calendarTokens?.access_token) {
    throw new HttpsError('failed-precondition', 'Calendar not connected. Please connect your Google Calendar.');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId.value(),
    clientSecret.value(),
    redirectUri.value()
  );

  oauth2Client.setCredentials(userData.calendarTokens);

  // Test token validity
  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.calendarList.list({ maxResults: 1 });
  } catch (error: any) {
    if (error.message === 'invalid_grant' || error.message?.includes('invalid_grant')) {
      throw new HttpsError('failed-precondition', 'Google Calendar access has expired. Please reconnect your Google account.');
    }
    throw new HttpsError('unavailable', 'Unable to access Google Calendar. Please check your connection.');
  }

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Convert Google Calendar API calendar list item to CalendarSummary
 */
function mapCalendarListItem(item: any): CalendarSummary {
  return {
    id: item.id,
    summary: item.summary || 'Untitled Calendar',
    accessRole: item.accessRole || 'reader',
    isPrimary: item.primary || false,
    selected: item.primary || false, // Default to selected for primary calendar
    backgroundColor: item.backgroundColor || '#7986cb',
    foregroundColor: item.colorId ? undefined : item.foregroundColor || '#ffffff',
    // Note: Google Calendar API doesn't return colorId directly in calendarList, but we can derive it
    colorId: item.colorId,
  };
}

/**
 * Convert Google Calendar API event to CalendarEvent
 */
function mapCalendarEvent(item: any, calendarId: string): CalendarEvent {
  return {
    id: item.id || '',
    calendarId,
    status: item.status || 'confirmed',
    summary: item.summary || 'Untitled Event',
    description: item.description,
    location: item.location,
    start: item.start || {},
    end: item.end || {},
    attendees: item.attendees?.map((a: any) => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus ? (a.responseStatus.toLowerCase() as 'accepted' | 'declined' | 'tentative' | 'needsAction') : undefined,
      optional: a.organizer || false, // Simplified: organizer is not optional
      avatarUrl: a.photoUrl,
    })),
    creator: item.creator,
    organizer: item.organizer,
    recurrence: item.recurrence,
    hangoutLink: item.hangoutLink || item.conferenceData?.entryPoints?.[0]?.uri,
    htmlLink: item.htmlLink,
    colorId: item.colorId,
    isAllDay: !item.start?.dateTime && !!item.start?.date,
    isRecurringInstance: !!item.recurringEventId,
    createdAt: item.created || new Date().toISOString(),
    updatedAt: item.updated || new Date().toISOString(),
  };
}

/**
 * List calendars for a user
 */
export const listCalendars = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId } = request.data;
  
  // Auth check: user can only access their own calendars
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only access your own calendars');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);
    
    const response = await calendar.calendarList.list({
      minAccessRole: 'reader', // Include all calendars user can read
    });

    const calendars: CalendarSummary[] = (response.data.items || []).map(mapCalendarListItem);

    return { calendars };
  } catch (error: any) {
    console.error('Error listing calendars:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to list calendars: ${error.message || 'Unknown error'}`);
  }
});

/**
 * List calendar events for a date range
 */
export const listEvents = onCall({
  cors: true,
  timeoutSeconds: 60,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const reqData = request.data as { userId: string } & ListCalendarEventsRequest;
  const { userId, calendarIds, timeMin, timeMax, timeZone, syncToken } = reqData;

  // Auth check
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only access your own calendar events');
  }

  if (!calendarIds || calendarIds.length === 0) {
    throw new HttpsError('invalid-argument', 'calendarIds is required');
  }

  if (!timeMin || !timeMax) {
    throw new HttpsError('invalid-argument', 'timeMin and timeMax are required');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);
    
    // Fetch events from all requested calendars and merge them
    const eventPromises = calendarIds.map(async (calId) => {
      try {
        const response = await calendar.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          timeZone: timeZone || undefined,
          syncToken: syncToken || undefined,
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 2500, // Google Calendar API max
        });
        return {
          calendarId: calId,
          events: (response.data.items || []).map((item) => mapCalendarEvent(item, calId)),
          nextSyncToken: response.data.nextSyncToken,
        };
      } catch (error: any) {
        console.error(`Error fetching events from calendar ${calId}:`, error);
        // Continue with other calendars even if one fails
        return {
          calendarId: calId,
          events: [],
          nextSyncToken: undefined,
        };
      }
    });

    const results = await Promise.all(eventPromises);
    
    // Merge events from all calendars
    const allEvents: CalendarEvent[] = results.flatMap((r) => r.events);
    
    // Sort by start time
    allEvents.sort((a, b) => {
      const aStart = a.start.dateTime || a.start.date || '';
      const bStart = b.start.dateTime || b.start.date || '';
      return aStart.localeCompare(bStart);
    });

    // Use the first non-null syncToken (in real implementation, we'd want to handle multiple)
    const nextSyncToken = results.find((r) => r.nextSyncToken)?.nextSyncToken;

    return {
      events: allEvents,
      nextSyncToken,
    };
  } catch (error: any) {
    console.error('Error listing calendar events:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to list calendar events: ${error.message || 'Unknown error'}`);
  }
});

/**
 * Create a calendar event
 */
export const createEvent = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, calendarId, payload } = request.data as {
    userId: string;
    calendarId: string;
    payload: CalendarEventInput;
  };

  // Auth check
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only create events in your own calendars');
  }

  if (!calendarId || !payload) {
    throw new HttpsError('invalid-argument', 'calendarId and payload are required');
  }

  if (!payload.summary) {
    throw new HttpsError('invalid-argument', 'Event summary (title) is required');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: payload.summary,
        description: payload.description,
        location: payload.location,
        start: payload.start,
        end: payload.end,
        attendees: payload.attendees,
        recurrence: payload.recurrence,
        conferenceData: payload.conferenceData,
        reminders: payload.reminders,
        colorId: payload.colorId,
      },
      conferenceDataVersion: payload.conferenceData ? 1 : undefined,
    });

    return mapCalendarEvent(event.data, calendarId);
  } catch (error: any) {
    console.error('Error creating calendar event:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to create calendar event: ${error.message || 'Unknown error'}`);
  }
});

/**
 * Update a calendar event
 */
export const updateEvent = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, calendarId, eventId, payload } = request.data as {
    userId: string;
    calendarId: string;
    eventId: string;
    payload: CalendarEventInput;
  };

  // Auth check
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only update events in your own calendars');
  }

  if (!calendarId || !eventId || !payload) {
    throw new HttpsError('invalid-argument', 'calendarId, eventId, and payload are required');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);

    const event = await calendar.events.update({
      calendarId,
      eventId,
      requestBody: {
        summary: payload.summary,
        description: payload.description,
        location: payload.location,
        start: payload.start,
        end: payload.end,
        attendees: payload.attendees,
        recurrence: payload.recurrence,
        conferenceData: payload.conferenceData,
        reminders: payload.reminders,
        colorId: payload.colorId,
      },
      conferenceDataVersion: payload.conferenceData ? 1 : undefined,
    });

    return mapCalendarEvent(event.data, calendarId);
  } catch (error: any) {
    console.error('Error updating calendar event:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to update calendar event: ${error.message || 'Unknown error'}`);
  }
});

/**
 * Delete a calendar event
 */
export const deleteEvent = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, calendarId, eventId } = request.data as {
    userId: string;
    calendarId: string;
    eventId: string;
  };

  // Auth check
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only delete events from your own calendars');
  }

  if (!calendarId || !eventId) {
    throw new HttpsError('invalid-argument', 'calendarId and eventId are required');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);

    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: 'none', // Don't send email notifications
    });

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting calendar event:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    // Google Calendar API returns 410 for already-deleted events, treat as success
    if (error.code === 410) {
      return { success: true };
    }
    throw new HttpsError('internal', `Failed to delete calendar event: ${error.message || 'Unknown error'}`);
  }
});

/**
 * RSVP to a calendar event (update attendee response status)
 * 
 * This allows users to respond to events they're invited to, even if they don't own the calendar.
 * Uses events.patch() to update only the user's attendee responseStatus.
 */
export const rsvpToEvent = onCall({
  cors: true,
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, calendarId, eventId, responseStatus, userEmail } = request.data as {
    userId: string;
    calendarId: string;
    eventId: string;
    responseStatus: 'accepted' | 'declined' | 'tentative';
    userEmail: string;
  };

  // Auth check
  if (!userId || userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only RSVP to events as yourself');
  }

  if (!calendarId || !eventId || !responseStatus || !userEmail) {
    throw new HttpsError('invalid-argument', 'calendarId, eventId, responseStatus, and userEmail are required');
  }

  if (!['accepted', 'declined', 'tentative'].includes(responseStatus)) {
    throw new HttpsError('invalid-argument', 'responseStatus must be "accepted", "declined", or "tentative"');
  }

  try {
    const calendar = await getAuthenticatedCalendarClient(userId);

    // First, get the current event to check if user is an attendee
    const currentEvent = await calendar.events.get({
      calendarId,
      eventId,
    });

    if (!currentEvent.data.attendees || currentEvent.data.attendees.length === 0) {
      throw new HttpsError('failed-precondition', 'This event has no attendees');
    }

    // Check if user is an attendee
    const userAttendee = currentEvent.data.attendees.find(
      (a) => a.email?.toLowerCase() === userEmail.toLowerCase()
    );

    if (!userAttendee) {
      throw new HttpsError('permission-denied', 'You are not an attendee of this event');
    }

    // Update only the user's attendee responseStatus using patch
    // We need to update the entire attendees array with the user's updated status
    const updatedAttendees = currentEvent.data.attendees.map((attendee) => {
      if (attendee.email?.toLowerCase() === userEmail.toLowerCase()) {
        return {
          ...attendee,
          // Google Calendar API expects lowercase responseStatus values:
          // 'needsAction' | 'declined' | 'tentative' | 'accepted'
          responseStatus,
        };
      }
      return attendee;
    });

    // Use patch to update only the attendees field
    const updatedEvent = await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        attendees: updatedAttendees,
      },
      sendUpdates: 'all', // Send email notifications to organizer
    });

    return mapCalendarEvent(updatedEvent.data, calendarId);
  } catch (error: any) {
    console.error('Error RSVPing to calendar event:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to RSVP to calendar event: ${error.message || 'Unknown error'}`);
  }
});

