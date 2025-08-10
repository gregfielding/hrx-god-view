import { onCall } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

// Get Calendar OAuth configuration from environment variables
const getCalendarOAuthConfig = () => {
  return {
    clientId: process.env.GMAIL_CLIENT_ID || process.env.FIREBASE_CONFIG_GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET || process.env.FIREBASE_CONFIG_GMAIL_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_REDIRECT_URI || process.env.FIREBASE_CONFIG_GMAIL_REDIRECT_URI
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
      calendarEventId: createdEvent.id,
      calendarEventLink: createdEvent.htmlLink,
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
export const syncCalendarEventsToCRM = onCall(async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { tenantId, userId } = request.data;
  if (!tenantId || !userId) {
    throw new Error('Tenant ID and User ID are required');
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
          if (attendee.email && attendee.email !== config.accountEmail) {
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

      // Create CRM activity
      const activityData = {
        type: 'calendar_event',
        title: event.summary,
        description: event.description || '',
        date: new Date(event.start?.dateTime || event.start?.date || ''),
        duration: event.start?.dateTime && event.end?.dateTime 
          ? Math.round((new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000)
          : 30,
        calendarEventId: event.id,
        calendarEventLink: event.htmlLink,
        meetingLink: event.conferenceData?.entryPoints?.[0]?.uri,
        contactId,
        dealId,
        companyId,
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
    throw new Error('Failed to sync calendar events');
  }
});

// Get user's calendar availability
export const getCalendarAvailability = onCall(async (request) => {
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