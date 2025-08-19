import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { syncTaskToCalendar as syncTaskToCalendarService, updateGoogleSync as updateGoogleSyncService, deleteGoogleSync as deleteGoogleSyncService } from './calendarSyncService';

const db = getFirestore();

// Google Calendar and Tasks API configuration
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.settings.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/tasks.readonly'
];

import { defineString } from 'firebase-functions/params';

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');

// Get Calendar OAuth configuration from Firebase config
const getCalendarOAuthConfig = () => {
  return {
    clientId: clientId.value(),
    clientSecret: clientSecret.value(),
    redirectUri: 'https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback'
  };
};

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  'https://us-central1-hrx1-d3beb.cloudfunctions.net/gmailOAuthCallback'
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
 * Handle Google Calendar OAuth callback (HTTP GET) and store tokens
 */
export const handleCalendarCallback = onRequest(async (req, res) => {
  try {
    const code = (req.query.code as string) || '';
    const state = (req.query.state as string) || '';

    if (!code || !state) {
      res.status(400).send('Missing required fields: code, state');
      return;
    }

    const { userId } = JSON.parse(state);

    const { tokens } = await oauth2Client.getToken(code);

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

    res.status(200).send('<html><body>Google Calendar connected. You can close this window.</body><script>window.close && window.close();</script></html>');
  } catch (error) {
    console.error('Error handling Calendar callback:', error);
    res.status(500).send('Failed to connect Calendar');
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

    // Set up OAuth client
    oauth2Client.setCredentials(calendarTokens);

    // Use the service function
    const result = await syncTaskToCalendarService(userId, tenantId, taskId, taskData);
    return result;

  } catch (error) {
    console.error('Error syncing task to Calendar:', error);
    throw new Error(`Failed to sync task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Update calendar event when task is updated
 */
export const updateGoogleSync = onCall({
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

    // Set up OAuth client
    oauth2Client.setCredentials(calendarTokens);

    // Use the service function
    const result = await updateGoogleSyncService(userId, tenantId, taskId, taskData);
    return result;

  } catch (error) {
    console.error('Error updating calendar event:', error);
    throw new Error(`Failed to update calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Delete calendar event when task is deleted
 */
export const deleteGoogleSync = onCall({
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

    // Set up OAuth client
    oauth2Client.setCredentials(calendarTokens);

    // Use the service function
    const result = await deleteGoogleSyncService(userId, tenantId, taskId);
    return result;

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
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      throw new HttpsError('failed-precondition', 'Calendar not connected');
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
  } catch (error: any) {
    console.error('Error listing calendar events:', error);
    if (error instanceof HttpsError) {
      // Preserve specific codes/messages for client handling
      throw error;
    }
    const message = typeof error?.message === 'string' ? error.message : 'Unknown error';
    // Surface the real message so the client can display actionable info
    throw new HttpsError('internal', message);
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
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Update tenant integration flags if present
    const integRef = db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail');
    const integSnap = await integRef.get();
    if (integSnap.exists) {
      await integRef.update({
        calendarEnabled: false,
        calendarConnected: false,
        calendarDisconnectedAt: new Date()
      });
    }

    // Also clear user-level tokens/flags so UI shows fully disconnected
    await db.collection('users').doc(userId).set({
      calendarTokens: null,
      calendarConnected: false,
      lastCalendarSync: null
    }, { merge: true });

    return { success: true, message: 'Google Calendar disconnected successfully' };
  } catch (error) {
    console.error('Error disconnecting Calendar:', error);
    throw new Error(`Failed to disconnect Calendar: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Disconnect ALL Google services (Gmail and Calendar) for a user
 */
export const disconnectAllGoogleServices = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    console.log(`Disconnecting all Google services for user ${userId} in tenant ${tenantId}`);

    // Update tenant integration flags if present
    const integRef = db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail');
    const integSnap = await integRef.get();
    if (integSnap.exists) {
      await integRef.update({
        calendarEnabled: false,
        calendarConnected: false,
        gmailConnected: false,
        calendarDisconnectedAt: new Date(),
        gmailDisconnectedAt: new Date()
      });
    }

    // Clear ALL user-level Google tokens and flags
    await db.collection('users').doc(userId).set({
      gmailTokens: null,
      gmailConnected: false,
      gmailConnectedAt: null,
      gmailDisconnectedAt: new Date(),
      calendarTokens: null,
      calendarConnected: false,
      calendarConnectedAt: null,
      lastCalendarSync: null,
      lastGmailSync: null
    }, { merge: true });

    console.log(`Successfully disconnected all Google services for user ${userId}`);

    return { 
      success: true, 
      message: 'All Google services (Gmail and Calendar) disconnected successfully' 
    };
  } catch (error) {
    console.error('Error disconnecting all Google services:', error);
    throw new Error(`Failed to disconnect Google services: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Enable Calendar sync for existing Gmail integration
 */
export const enableCalendarSync = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Get the current Gmail integration config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    
    if (!configDoc.exists) {
      throw new Error('Gmail integration not found. Please connect Gmail first.');
    }

    const config = configDoc.data() as any;
    
    if (!config.accessToken) {
      throw new Error('Gmail integration not properly configured. Please reconnect Gmail.');
    }

    // Test the access token with Calendar API using the v2 params-authenticated client
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    // Test Calendar API access
    const test = await calendar.calendarList.list().catch((calendarError: any) => {
      console.error('Calendar API test failed:', calendarError?.response?.data || calendarError);
      const message = calendarError?.response?.data?.error?.message || calendarError?.message || 'Unknown calendar error';
      throw new HttpsError('failed-precondition', `Calendar scope missing: ${message}`);
    });

    // Update the Gmail integration to enable calendar sync
    await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').update({
      calendarEnabled: true,
      calendarConnected: true,
      calendarConnectedAt: new Date(),
      calendarDisconnectedAt: null
    });

    return { success: true, message: 'Google Calendar sync enabled successfully' };
  } catch (error: any) {
    console.error('Error enabling Calendar sync:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    const message = typeof error?.message === 'string' ? error.message : 'Unknown error';
    throw new HttpsError('internal', message);
  }
});

/**
 * Clear expired Google tokens and force re-authentication
 */
export const clearExpiredTokens = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    console.log(`Clearing expired tokens for user ${userId} in tenant ${tenantId}`);

    // Clear ALL user-level Google tokens and flags
    await db.collection('users').doc(userId).set({
      gmailTokens: null,
      gmailConnected: false,
      gmailConnectedAt: null,
      gmailDisconnectedAt: new Date(),
      calendarTokens: null,
      calendarConnected: false,
      calendarConnectedAt: null,
      lastCalendarSync: null,
      lastGmailSync: null
    }, { merge: true });

    // Update tenant integration flags if present
    const integRef = db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail');
    const integSnap = await integRef.get();
    if (integSnap.exists) {
      await integRef.update({
        calendarEnabled: false,
        calendarConnected: false,
        gmailConnected: false,
        calendarDisconnectedAt: new Date(),
        gmailDisconnectedAt: new Date()
      });
    }

    console.log(`Successfully cleared expired tokens for user ${userId}`);

    return { 
      success: true, 
      message: 'Expired tokens cleared. Please reconnect your Google account.' 
    };
  } catch (error) {
    console.error('Error clearing expired tokens:', error);
    throw new Error(`Failed to clear expired tokens: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});
