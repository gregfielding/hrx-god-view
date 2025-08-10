import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';

const db = getFirestore();

// Google Calendar API configuration
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.settings.readonly'
];

import { defineString } from 'firebase-functions/params';

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  'https://us-central1-hrx1-d3beb.cloudfunctions.net/handleCalendarCallback'
);

/**
 * Get Google Calendar OAuth URL for user authentication
 */
export const getCalendarAuthUrl = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    const state = JSON.stringify({ userId, tenantId });
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: CALENDAR_SCOPES,
      state,
      prompt: 'consent'
    });

    return { authUrl };
  } catch (error) {
    console.error('Error generating Calendar auth URL:', error);
    throw new Error(`Failed to generate auth URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Handle Google Calendar OAuth callback and store tokens
 */
export const handleCalendarCallback = onCall({
  cors: true
}, async (request) => {
  try {
    const { code, state } = request.data;

    if (!code || !state) {
      throw new Error('Missing required fields: code, state');
    }

    const { userId } = JSON.parse(state);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Store tokens securely
    await db.collection('users').doc(userId).update({
      calendarTokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date
      },
      calendarConnected: true,
      calendarConnectedAt: new Date()
    });

    return { success: true, message: 'Google Calendar connected successfully' };
  } catch (error) {
    console.error('Error handling Calendar callback:', error);
    throw new Error(`Failed to connect Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Sync task to Google Calendar
 */
export const syncTaskToCalendar = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId, taskId, taskData } = request.data;

    if (!userId || !tenantId || !taskId || !taskData) {
      throw new Error('Missing required fields: userId, tenantId, taskId, taskData');
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      throw new Error('Google Calendar not connected. Please authenticate first.');
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Determine if this is an appointment or todo
    const isAppointment = taskData.classification === 'appointment';
    
    if (isAppointment) {
      // Create calendar event for appointment
      const event = {
        summary: taskData.title,
        description: taskData.description || '',
        start: {
          dateTime: taskData.startTime,
          timeZone: 'America/Los_Angeles'
        },
        end: {
          dateTime: taskData.endTime || new Date(new Date(taskData.startTime).getTime() + (taskData.duration || 60) * 60000).toISOString(),
          timeZone: 'America/Los_Angeles'
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 10 }
          ]
        },
        extendedProperties: {
          private: {
            taskId: taskId,
            tenantId: tenantId,
            crmTask: 'true'
          }
        }
      };

      const response = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event
      });

      // Update task with calendar event ID
      await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
        googleCalendarEventId: response.data.id,
        lastGoogleSync: new Date(),
        syncStatus: 'synced'
      });

      return {
        success: true,
        eventId: response.data.id,
        message: 'Task synced to Google Calendar'
      };
    } else {
      // For todos, we'll create a Google Task instead
      // Note: Google Tasks API requires separate implementation
      console.log('Todo tasks will be implemented with Google Tasks API');
      
      return {
        success: true,
        message: 'Todo task sync to Google Tasks coming soon'
      };
    }

  } catch (error) {
    console.error('Error syncing task to Calendar:', error);
    throw new Error(`Failed to sync task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Update calendar event when task is updated
 */
export const updateCalendarEvent = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId, taskId, taskData } = request.data;

    if (!userId || !tenantId || !taskId || !taskData) {
      throw new Error('Missing required fields: userId, tenantId, taskId, taskData');
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      throw new Error('Google Calendar not connected. Please authenticate first.');
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get the task to find the calendar event ID
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }

    const task = taskDoc.data();
    const eventId = task?.googleCalendarEventId;

    if (!eventId) {
      throw new Error('Task not synced to calendar yet');
    }

    // Update calendar event
    const event = {
      summary: taskData.title,
      description: taskData.description || '',
      start: {
        dateTime: taskData.startTime,
        timeZone: 'America/Los_Angeles'
      },
      end: {
        dateTime: taskData.endTime || new Date(new Date(taskData.startTime).getTime() + (taskData.duration || 60) * 60000).toISOString(),
        timeZone: 'America/Los_Angeles'
      }
    };

    await calendar.events.update({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: event
    });

    // Update task sync status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      lastGoogleSync: new Date(),
      syncStatus: 'synced'
    });

    return { success: true, message: 'Calendar event updated' };

  } catch (error) {
    console.error('Error updating calendar event:', error);
    throw new Error(`Failed to update calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Delete calendar event when task is deleted
 */
export const deleteCalendarEvent = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId, taskId } = request.data;

    if (!userId || !tenantId || !taskId) {
      throw new Error('Missing required fields: userId, tenantId, taskId');
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      throw new Error('Google Calendar not connected. Please authenticate first.');
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get the task to find the calendar event ID
    const taskDoc = await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).get();
    if (!taskDoc.exists) {
      throw new Error('Task not found');
    }

    const task = taskDoc.data();
    const eventId = task?.googleCalendarEventId;

    if (eventId) {
      // Delete calendar event
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId
      });
    }

    // Update task sync status
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskId).update({
      googleCalendarEventId: null,
      lastGoogleSync: new Date(),
      syncStatus: 'deleted'
    });

    return { success: true, message: 'Calendar event deleted' };

  } catch (error) {
    console.error('Error deleting calendar event:', error);
    throw new Error(`Failed to delete calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Get Google Calendar connection status for a user
 */
export const getCalendarStatus = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    console.log('Calendar status check - userData:', {
      calendarConnected: userData?.calendarConnected,
      hasCalendarTokens: !!userData?.calendarTokens?.access_token,
      email: userData?.calendarTokens?.email || userData?.email,
      fullUserData: userData // Log the entire user data to see what's actually stored
    });
    
    const connected = !!(userData?.calendarConnected && userData?.calendarTokens?.access_token);
    const email = userData?.calendarTokens?.email || userData?.email;
    const lastSync = userData?.lastCalendarSync;
    const syncStatus = connected ? 'not_synced' : 'not_synced';

    console.log('Calendar status result:', { connected, email, lastSync, syncStatus });

    return {
      connected,
      email,
      lastSync,
      syncStatus
    };
  } catch (error) {
    console.error('Error getting Calendar status:', error);
    throw new Error(`Failed to get Calendar status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * List calendar events for a user
 */
export const listCalendarEvents = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, maxResults = 50, timeMin, timeMax } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      throw new Error('Calendar not connected');
    }

    // Set up OAuth2 client
    oauth2Client.setCredentials(userData.calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get events from primary calendar
    const eventsResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = eventsResponse.data.items?.map(event => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      location: event.location,
      attendees: event.attendees,
      created: event.created,
      updated: event.updated,
      status: event.status
    })) || [];

    return {
      success: true,
      events,
      totalEvents: events.length
    };
  } catch (error) {
    console.error('Error listing calendar events:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpsError('internal', 'Failed to list calendar events', { message });
  }
});

/**
 * Create calendar event
 */
export const createCalendarEvent = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, eventData } = request.data;

    if (!userId || !eventData) {
      throw new Error('Missing required fields: userId, eventData');
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      throw new Error('Calendar not connected');
    }

    // Set up OAuth2 client
    oauth2Client.setCredentials(userData.calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Create event
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: eventData.summary,
        description: eventData.description,
        start: eventData.start,
        end: eventData.end,
        location: eventData.location,
        attendees: eventData.attendees
      }
    });

    return {
      success: true,
      event: event.data,
      message: 'Calendar event created successfully'
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw new Error(`Failed to create calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Disconnect Google Calendar for a user
 */
export const disconnectCalendar = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    // Remove Calendar tokens
    await db.collection('users').doc(userId).update({
      calendarTokens: null,
      calendarConnected: false,
      calendarDisconnectedAt: new Date()
    });

    return { success: true, message: 'Google Calendar disconnected successfully' };
  } catch (error) {
    console.error('Error disconnecting Calendar:', error);
    throw new Error(`Failed to disconnect Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
