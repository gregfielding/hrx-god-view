import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';

const db = getFirestore();

// Configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  'https://us-central1-hrx1-d3beb.cloudfunctions.net/handleCalendarCallback'
);

interface CalendarWebhookPayload {
  state: string;
  resourceId: string;
  resourceUri: string;
  channelId: string;
  expiration?: string;
}

interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end?: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  organizer?: {
    email: string;
    displayName?: string;
  };
  created?: string;
  updated?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
    }>;
  };
}

/**
 * Set up calendar watch for push notifications
 */
export const setupCalendarWatch = onRequest({
  cors: true
}, async (req, res) => {
  try {
    const { userId, tenantId } = req.body;

    if (!userId || !tenantId) {
      res.status(400).json({ error: 'Missing userId or tenantId' });
      return;
    }

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (!calendarTokens?.access_token) {
      res.status(400).json({ error: 'Google Calendar not connected' });
      return;
    }

    // Set up Calendar API client
    oauth2Client.setCredentials(calendarTokens);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Create a unique channel ID for this watch
    const channelId = `crm-watch-${tenantId}-${userId}-${Date.now()}`;
    
    // Set up watch request
    const watchResponse = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: `https://us-central1-hrx1-d3beb.cloudfunctions.net/calendarWebhook`,
        params: {
          ttl: '604800' // 7 days in seconds
        }
      }
    });

    // Store watch information
    await db.collection('tenants').doc(tenantId).collection('calendarWatches').doc(userId).set({
      channelId: watchResponse.data.id,
      resourceId: watchResponse.data.resourceId,
      resourceUri: watchResponse.data.resourceUri,
      expiration: watchResponse.data.expiration,
      userId,
      tenantId,
      createdAt: new Date(),
      active: true
    });

    res.json({
      success: true,
      watchId: watchResponse.data.id,
      expiration: watchResponse.data.expiration,
      message: 'Calendar watch set up successfully'
    });

  } catch (error: any) {
    console.error('Error setting up calendar watch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle incoming calendar webhook notifications
 */
export const calendarWebhook = onRequest({
  cors: true
}, async (req, res) => {
  try {
    // Handle webhook verification (Google sends a GET request first)
    if (req.method === 'GET') {
      const { 'x-goog-resource-state': resourceState } = req.headers;
      
      if (resourceState === 'sync') {
        // This is the initial sync request, just acknowledge it
        res.status(200).send('OK');
        return;
      }
    }

    // Handle actual webhook notification
    if (req.method === 'POST') {
      const { headers, body } = req;
      
      // Verify the webhook is from Google (you can add more verification here)
      const userAgent = headers['user-agent'] || '';
      if (!userAgent.includes('Google-Calendar-Notifications')) {
        res.status(403).json({ error: 'Unauthorized webhook source' });
        return;
      }

      // Process the webhook payload
      const webhookData: CalendarWebhookPayload = body;
      
      console.log('Received calendar webhook:', webhookData);

      // Extract user and tenant info from the resource URI
      // The resource URI contains the calendar ID, which we can use to find the watch
      const resourceUri = webhookData.resourceUri;
      
      // Find the watch record to get user and tenant info
      const watchesSnapshot = await db.collectionGroup('calendarWatches')
        .where('resourceUri', '==', resourceUri)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (watchesSnapshot.empty) {
        console.log('No active watch found for resource URI:', resourceUri);
        res.status(200).send('OK');
        return;
      }

      const watchDoc = watchesSnapshot.docs[0];
      const watchData = watchDoc.data();
      const { userId, tenantId } = watchData;

      // Get user's Calendar tokens
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        console.error('User not found for webhook:', userId);
        res.status(200).send('OK');
        return;
      }

      const userData = userDoc.data();
      const calendarTokens = userData?.calendarTokens;

      if (!calendarTokens?.access_token) {
        console.error('Calendar tokens not found for user:', userId);
        res.status(200).send('OK');
        return;
      }

      // Set up Calendar API client
      oauth2Client.setCredentials(calendarTokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Get the updated events from the calendar
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const eventsResponse = await calendar.events.list({
        calendarId: 'primary',
        timeMin: oneWeekAgo.toISOString(),
        timeMax: oneWeekFromNow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        updatedMin: new Date(Date.now() - 5 * 60 * 1000).toISOString() // Events updated in last 5 minutes
      });

      const events = eventsResponse.data.items || [];
      
      // Process each event
      for (const event of events) {
        await processCalendarEvent(event, tenantId, userId);
      }

      res.status(200).send('OK');
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Error processing calendar webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Process a calendar event and create/update CRM activities
 */
async function processCalendarEvent(event: CalendarEvent, tenantId: string, userId: string) {
  try {
    if (!event.id || !event.summary) {
      return;
    }

    // Check if this event is already processed
    const existingActivity = await db.collection('tenants').doc(tenantId).collection('activities')
      .where('calendarEventId', '==', event.id)
      .limit(1)
      .get();

    if (!existingActivity.empty) {
      // Update existing activity
      const activityDoc = existingActivity.docs[0];
      await activityDoc.ref.update({
        title: event.summary,
        description: event.description || '',
        date: new Date(event.start?.dateTime || event.start?.date || ''),
        duration: event.start?.dateTime && event.end?.dateTime 
          ? Math.round((new Date(event.end.dateTime).getTime() - new Date(event.start.dateTime).getTime()) / 60000)
          : 30,
        calendarEventLink: event.htmlLink,
        meetingLink: event.hangoutLink || event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri,
        updatedAt: new Date()
      });
      return;
    }

    // Extract contact information from attendees
    let contactId = null;
    let dealId = null;
    let companyId = null;
    let matchedContacts: string[] = [];

    // Try to find contacts by email in attendees
    if (event.attendees) {
      for (const attendee of event.attendees) {
        if (attendee.email) {
          // Skip the organizer (usually the user themselves)
          if (attendee.email === event.organizer?.email) {
            continue;
          }

          // Search for contact by email
          const contactQuery = await db.collection('tenants').doc(tenantId).collection('crm_contacts')
            .where('email', '==', attendee.email)
            .limit(1)
            .get();
          
          if (!contactQuery.empty) {
            const contactDoc = contactQuery.docs[0];
            contactId = contactDoc.id;
            const contactData = contactDoc.data();
            companyId = contactData.companyId;
            matchedContacts.push(contactDoc.id);
          }
        }
      }
    }

    // If we found a contact, try to find associated deals
    if (contactId) {
      const dealsQuery = await db.collection('tenants').doc(tenantId).collection('crm_deals')
        .where('contactIds', 'array-contains', contactId)
        .limit(1)
        .get();
      
      if (!dealsQuery.empty) {
        dealId = dealsQuery.docs[0].id;
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
      meetingLink: event.hangoutLink || event.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri,
      contactId,
      dealId,
      companyId,
      matchedContacts,
      attendees: event.attendees?.map(attendee => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus
      })) || [],
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      source: 'calendar_webhook',
      isExternal: true // Mark as external event
    };

    await db.collection('tenants').doc(tenantId).collection('activities').add(activityData);

    // Log AI action for analytics
    await logAIAction({
      userId,
      actionType: 'calendar_event_processed',
      sourceModule: 'CalendarWebhooks',
      success: true,
      latencyMs: 0,
      versionTag: 'v1',
      reason: `Processed calendar event: ${event.summary}`,
      metadata: {
        eventId: event.id,
        contactId,
        dealId,
        matchedContactsCount: matchedContacts.length
      }
    });

    console.log(`Processed calendar event: ${event.summary} (${event.id})`);

  } catch (error: any) {
    console.error(`Error processing calendar event ${event.id}:`, error);
    
    // Log AI action for error tracking
    await logAIAction({
      userId,
      actionType: 'calendar_event_processed',
      sourceModule: 'CalendarWebhooks',
      success: false,
      errorMessage: error.message,
      latencyMs: 0,
      versionTag: 'v1',
      reason: `Failed to process calendar event: ${event.summary}`,
      metadata: {
        eventId: event.id
      }
    });
  }
}

/**
 * Stop calendar watch
 */
export const stopCalendarWatch = onRequest({
  cors: true
}, async (req, res) => {
  try {
    const { userId, tenantId } = req.body;

    if (!userId || !tenantId) {
      res.status(400).json({ error: 'Missing userId or tenantId' });
      return;
    }

    // Get the watch record
    const watchDoc = await db.collection('tenants').doc(tenantId).collection('calendarWatches').doc(userId).get();
    
    if (!watchDoc.exists) {
      res.status(404).json({ error: 'No active watch found' });
      return;
    }

    const watchData = watchDoc.data();

    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const userData = userDoc.data();
    const calendarTokens = userData?.calendarTokens;

    if (calendarTokens?.access_token) {
      // Set up Calendar API client
      oauth2Client.setCredentials(calendarTokens);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Stop the watch
      try {
        await calendar.channels.stop({
          requestBody: {
            id: watchData.channelId,
            resourceId: watchData.resourceId
          }
        });
      } catch (error) {
        console.log('Watch may have already expired:', error);
      }
    }

    // Update the watch record
    await watchDoc.ref.update({
      active: false,
      stoppedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Calendar watch stopped successfully'
    });

  } catch (error: any) {
    console.error('Error stopping calendar watch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Refresh calendar watch (renew before expiration)
 */
export const refreshCalendarWatch = onRequest({
  cors: true
}, async (req, res) => {
  try {
    const { userId, tenantId } = req.body;

    if (!userId || !tenantId) {
      res.status(400).json({ error: 'Missing userId or tenantId' });
      return;
    }

    // Stop existing watch
    await stopCalendarWatch(req, res);
    
    // Set up new watch
    await setupCalendarWatch(req, res);

  } catch (error: any) {
    console.error('Error refreshing calendar watch:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function for AI logging (import from your existing utils)
async function logAIAction(data: any) {
  try {
    await db.collection('aiLogs').add({
      ...data,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging AI action:', error);
  }
}
