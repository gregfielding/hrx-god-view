import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { google } from 'googleapis';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

// Google OAuth configuration using Firebase Functions v2 params
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

// Get Calendar OAuth configuration from Firebase config
const getCalendarOAuthConfig = () => {
  return {
    clientId: clientId.value(),
    clientSecret: clientSecret.value(),
    redirectUri: redirectUri.value()
  };
};

interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
  }>;
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: {
        type: 'hangoutsMeet';
      };
    };
  };
}



// Create calendar event from CRM task
export const createCalendarEventFromTask = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, taskData } = request.data;
  if (!tenantId || !taskData) {
    throw new Error('Tenant ID and task data are required');
  }

  try {
    // Resolve OAuth tokens: prefer tenant-level integration, fallback to user-level tokens
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let accountEmail: string | undefined;

    // Try tenant-level integration first
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (configDoc.exists) {
      const cfg = configDoc.data() as any;
      accountEmail = cfg?.accountEmail;
      if (cfg?.enabled && cfg?.accessToken) {
        accessToken = cfg.accessToken;
        refreshToken = cfg.refreshToken;
      }
    }

    // Fallback to user-level tokens if needed
    if (!accessToken) {
      // userId is available in request.data for callable handlers; guard above already validated
      const userDoc = await db.collection('users').doc((request as any).data?.userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data() as any;
        const tokens = userData?.calendarTokens || userData?.gmailTokens;
        if (tokens?.access_token) {
          accessToken = tokens.access_token;
          refreshToken = tokens.refresh_token;
          accountEmail = tokens?.email || accountEmail;
          console.log('Using user-level Google tokens for calendar sync');
        }
      }
    }

    if (!accessToken) {
      throw new Error('Google Calendar not connected or tokens missing');
    }

    // Initialize OAuth2 client
    const oauthConfig = getCalendarOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret,
      oauthConfig.redirectUri
    );
    
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Convert task to calendar event
    const event: CalendarEvent = {
      summary: taskData.title,
      description: taskData.description || `Task: ${taskData.title}`,
      start: {
        dateTime: taskData.scheduledDate.toISOString(),
        timeZone: 'America/Los_Angeles' // Default timezone
      },
      end: {
        dateTime: new Date(taskData.scheduledDate.getTime() + (taskData.duration || 30) * 60000).toISOString(),
        timeZone: 'America/Los_Angeles'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 15 },
          { method: 'email', minutes: 30 }
        ]
      }
    };

    // Add attendees if provided
    if (taskData.attendees && taskData.attendees.length > 0) {
      event.attendees = taskData.attendees.map((email: string) => ({ email }));
    }

    // Create the event
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1 // Enable Google Meet integration
    });

    const createdEvent = response.data;

    // Update task with calendar event ID
    await db.collection('tenants').doc(tenantId).collection('tasks').doc(taskData.taskId).update({
      calendarEventId: createdEvent.id || null,
      calendarEventLink: createdEvent.htmlLink || null,
      meetingLink: createdEvent?.conferenceData?.entryPoints?.[0]?.uri || null,
      lastUpdated: new Date()
    });

    return {
      success: true,
      eventId: createdEvent.id,
      eventLink: createdEvent.htmlLink,
      meetingLink: createdEvent.conferenceData?.entryPoints?.[0]?.uri
    };

  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw new Error('Failed to create calendar event');
  }
});

// Sync calendar events to CRM activities
export const syncCalendarEventsToCRM = onCall({
  cors: true
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { tenantId, userId } = request.data;
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Tenant ID and User ID are required');
  }

  try {
    // Resolve OAuth tokens: prefer tenant-level integration, fallback to user-level tokens
    let accessToken: string | undefined;
    let refreshToken: string | undefined;
    let accountEmail: string | undefined;

    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (configDoc.exists) {
      const cfg = configDoc.data() as any;
      accountEmail = cfg?.accountEmail;
      if (cfg?.enabled && cfg?.accessToken) {
        accessToken = cfg.accessToken;
        refreshToken = cfg.refreshToken;
      }
    }

    // Fallback to user-level tokens if tenant-level not available
    if (!accessToken) {
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data() as any;
        const tokens = userData?.calendarTokens || userData?.gmailTokens;
        if (tokens?.access_token) {
          accessToken = tokens.access_token;
          refreshToken = tokens.refresh_token;
          accountEmail = tokens?.email || accountEmail;
          console.log('Using user-level Google tokens for calendar sync');
        }
      }
    }

    if (!accessToken) {
      throw new HttpsError('failed-precondition', 'Google Calendar not connected or tokens missing');
    }

    // Initialize OAuth2 client
    const oauthConfig = getCalendarOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret,
      oauthConfig.redirectUri
    );
    
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    // Test token validity before proceeding
    try {
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      await calendar.calendarList.list({ maxResults: 1 });
      console.log('Calendar API token validation successful');
    } catch (tokenError) {
      console.error('Token validation failed:', tokenError);
      console.error('Token error details:', {
        message: tokenError.message,
        code: tokenError.code,
        stack: tokenError.stack
      });
      
      // Handle invalid_grant error specifically
      if (tokenError.message === 'invalid_grant' || 
          (tokenError.message && tokenError.message.includes('invalid_grant'))) {
        throw new HttpsError('failed-precondition', 'Google Calendar access has expired. Please reconnect your Google account.');
      }
      
      throw new HttpsError('unavailable', 'Unable to access Google Calendar. Please check your connection.');
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    console.log('Calendar API initialized successfully');

    // Get events from the last 30 days and next 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: thirtyDaysAgo.toISOString(),
      timeMax: thirtyDaysFromNow.toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];
    let syncedCount = 0;
    let linkedContacts = 0;

    for (const event of events) {
      if (!event.id || !event.summary) continue;

      // Check if this event is already synced
      const existingActivity = await db.collection('tenants').doc(tenantId).collection('activities')
        .where('calendarEventId', '==', event.id)
        .limit(1)
        .get();

      if (!existingActivity.empty) continue;

      // Extract contact information from event description or attendees
      let contactId = null;
      let dealId = null;
      let companyId = null;

      // Try to find contact by email in attendees
      if (event.attendees) {
        for (const attendee of event.attendees) {
          if (attendee.email && (!accountEmail || attendee.email !== accountEmail)) {
            const contactQuery = await db.collection('tenants').doc(tenantId).collection('crm_contacts')
              .where('email', '==', attendee.email)
              .limit(1)
              .get();
            
            if (!contactQuery.empty) {
              contactId = contactQuery.docs[0].id;
              const contactData = contactQuery.docs[0].data();
              companyId = contactData.companyId;
              break;
            }
          }
        }
      }

      // Create CRM activity (avoid undefined values for Firestore)
      const startRaw = event.start?.dateTime || event.start?.date || null;
      const eventDate = startRaw ? new Date(startRaw) : new Date();
      const durationMinutes = event.start?.dateTime && event.end?.dateTime
        ? Math.round((new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000)
        : 30;

      const activityData: any = {
        type: 'calendar_event',
        title: event.summary || '(Untitled Event)',
        description: event.description || '',
        date: eventDate,
        duration: durationMinutes,
        calendarEventId: event.id || null,
        calendarEventLink: event.htmlLink || null,
        meetingLink: event?.conferenceData?.entryPoints?.[0]?.uri || null,
        contactId: contactId || null,
        dealId: dealId || null,
        companyId: companyId || null,
        createdBy: userId,
        createdAt: new Date()
      };

      await db.collection('tenants').doc(tenantId).collection('activities').add(activityData);
      syncedCount++;

      if (contactId) linkedContacts++;
    }

    return {
      success: true,
      syncedCount,
      linkedContacts,
      totalEvents: events.length
    };

  } catch (error) {
    console.error('Error syncing calendar events:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    
    // Handle specific OAuth errors
    if (error.message === 'invalid_grant' || error.message.includes('Google Calendar access has expired')) {
      throw new HttpsError('failed-precondition', 'Google Calendar access has expired. Please reconnect your Google account.');
    }
    
    if (error.code === 'ERR_INVALID_ARGUMENT') {
      throw new HttpsError('invalid-argument', 'Invalid Google Calendar configuration. Please check your settings.');
    }
    
    // Check if it's a GaxiosError with invalid_grant
    if (error.message && error.message.includes('invalid_grant')) {
      throw new HttpsError('failed-precondition', 'Google Calendar access has expired. Please reconnect your Google account.');
    }
    
    throw new HttpsError('internal', `Failed to sync calendar events: ${error.message}`);
  }
});

// Get user's calendar availability
export const getCalendarAvailability = onCall({
  cors: true
}, async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, startDate, endDate } = request.data;
  if (!tenantId || !startDate || !endDate) {
    throw new Error('Tenant ID, start date, and end date are required');
  }

  try {
    // Get Gmail/Calendar config
    const configDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    if (!configDoc.exists) {
      throw new Error('Gmail/Calendar integration not configured');
    }

    const config = configDoc.data() as any;
    if (!config.enabled || !config.accessToken) {
      throw new Error('Gmail/Calendar integration not enabled or not authenticated');
    }

    // Initialize OAuth2 client
    const oauthConfig = getCalendarOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret,
      oauthConfig.redirectUri
    );
    
    oauth2Client.setCredentials({
      access_token: config.accessToken,
      refresh_token: config.refreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get busy times
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate,
        timeMax: endDate,
        items: [{ id: 'primary' }]
      }
    });

    const busyTimes = response.data.calendars?.primary?.busy || [];

    return {
      success: true,
      busyTimes,
      startDate,
      endDate
    };

  } catch (error) {
    console.error('Error getting calendar availability:', error);
    throw new Error('Failed to get calendar availability');
  }
}); 

/**
 * Test Google Calendar token validity and force re-authentication if needed
 */
export const testCalendarTokenValidity = onCall({
  cors: true
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, tenantId } = request.data;
  if (!userId || !tenantId) {
    throw new HttpsError('invalid-argument', 'User ID and Tenant ID are required');
  }

  try {
    // 1) Prefer tenant-level integration tokens if present (these are used by sync)
    const integrationDoc = await db.collection('tenants').doc(tenantId).collection('integrations').doc('gmail').get();
    const oauthConfig = getCalendarOAuthConfig();
    const oauth2Client = new google.auth.OAuth2(
      oauthConfig.clientId,
      oauthConfig.clientSecret,
      oauthConfig.redirectUri
    );

    if (integrationDoc.exists) {
      const cfg = integrationDoc.data() as any;
      const accessToken = cfg?.accessToken;
      const refreshToken = cfg?.refreshToken;
      const enabled = cfg?.enabled;

      if (enabled && accessToken) {
        oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
        try {
          await calendar.calendarList.list({ maxResults: 1 });
          return { valid: true, reason: 'Tenant-level token is valid', needsReauth: false, source: 'tenant' };
        } catch (error: any) {
          if (error?.message?.includes('invalid_grant') || error?.message?.includes('unauthorized')) {
            // Clear tenant-level tokens so future calls don't use them
            await integrationDoc.ref.set({
              enabled: false,
              accessToken: null,
              refreshToken: null,
              calendarEnabled: false,
              lastCalendarSync: null
            }, { merge: true });
            return { valid: false, reason: 'Tenant-level token expired', needsReauth: true, source: 'tenant' };
          }
          return { valid: false, reason: `Tenant-level API error: ${error.message}` , needsReauth: false, source: 'tenant' };
        }
      }
    }

    // 2) Fallback to user-level tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data() as any;
    const tokens = userData?.calendarTokens;

    if (!tokens?.access_token) {
      return { valid: false, reason: 'No user tokens found', needsReauth: true, source: 'user' };
    }

    oauth2Client.setCredentials({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    try {
      await calendar.calendarList.list({ maxResults: 1 });
      return { valid: true, reason: 'User token is valid', needsReauth: false, source: 'user' };
    } catch (error: any) {
      console.log('User token validation failed:', error.message);
      if (error?.message?.includes('invalid_grant') || error?.message?.includes('unauthorized')) {
        await db.collection('users').doc(userId).set({
          calendarTokens: null,
          calendarConnected: false,
          calendarConnectedAt: null,
          lastCalendarSync: null
        }, { merge: true });
        return { valid: false, reason: 'User token is invalid or expired', needsReauth: true, source: 'user' };
      }
      return { valid: false, reason: `User token API error: ${error.message}`, needsReauth: false, source: 'user' };
    }
  } catch (error) {
    console.error('Error testing token validity:', error);
    throw new HttpsError('internal', `Failed to test token validity: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}); 