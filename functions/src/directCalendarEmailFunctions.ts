import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';

// Google OAuth configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Cache for API calls
const apiCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours cache (very aggressive)

// Cleanup cache every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of apiCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION_MS) {
      apiCache.delete(key);
    }
  }
}, 15 * 60 * 1000);

// Get Calendar Status
export const getCalendarStatus = onCall({
  cors: true,
  maxInstances: 3
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId } = request.data;
  
  if (!userId) {
    throw new HttpsError('invalid-argument', 'User ID is required');
  }

  // Create cache key
  const cacheKey = `calendar_status_${userId}`;
  
  // Check cache first
  const cached = apiCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
    console.log('Calendar status served from cache for user:', userId);
    return cached.data;
  }

  try {
    // Get user's Calendar tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      const result = { connected: false, message: 'Calendar not connected' };
      apiCache.set(cacheKey, { data: result, timestamp: now });
      return result;
    }

    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
    oauth2Client.setCredentials(userData.calendarTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Test calendar access
    await calendar.calendarList.list({ maxResults: 1 });

    const result = { connected: true, message: 'Calendar connected' };
    
    // Cache the result
    apiCache.set(cacheKey, { data: result, timestamp: now });
    
    return result;
  } catch (error: any) {
    console.error('Error checking calendar status:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
      const result = { connected: false, message: 'Calendar authentication expired' };
      apiCache.set(cacheKey, { data: result, timestamp: now });
      return result;
    }
    
    const result = { connected: false, message: 'Calendar connection error' };
    apiCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  }
});

// Get Gmail Status
export const getGmailStatus = onCall({
  cors: true,
  maxInstances: 3
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId } = request.data;
  
  if (!userId) {
    throw new HttpsError('invalid-argument', 'User ID is required');
  }

  // Create cache key
  const cacheKey = `gmail_status_${userId}`;
  
  // Check cache first
  const cached = apiCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
    console.log('Gmail status served from cache for user:', userId);
    return cached.data;
  }

  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data();
    if (!userData?.gmailTokens?.access_token) {
      const result = { connected: false, message: 'Gmail not connected' };
      apiCache.set(cacheKey, { data: result, timestamp: now });
      return result;
    }

    // Set up OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
    oauth2Client.setCredentials(userData.gmailTokens);
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test Gmail access
    await gmail.users.getProfile({ userId: 'me' });

    const result = { connected: true, message: 'Gmail connected' };
    
    // Cache the result
    apiCache.set(cacheKey, { data: result, timestamp: now });
    
    return result;
  } catch (error: any) {
    console.error('Error checking Gmail status:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
      const result = { connected: false, message: 'Gmail authentication expired' };
      apiCache.set(cacheKey, { data: result, timestamp: now });
      return result;
    }
    
    const result = { connected: false, message: 'Gmail connection error' };
    apiCache.set(cacheKey, { data: result, timestamp: now });
    return result;
  }
});

// List Calendar Events
export const listCalendarEvents = onCall({
  cors: true,
  maxInstances: 3
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { userId, maxResults = 50, timeMin, timeMax } = request.data;

  if (!userId) {
    throw new HttpsError('invalid-argument', 'User ID is required');
  }

  // Create cache key based on parameters
  const cacheKey = `calendar_events_${userId}_${maxResults}_${timeMin || 'default'}_${timeMax || 'default'}`;
  
  // Check cache first
  const cached = apiCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
    console.log('Calendar events served from cache for user:', userId);
    return cached.data;
  }

  try {
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
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
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

    const result = {
      success: true,
      events,
      totalEvents: events.length
    };

    // Cache the result
    apiCache.set(cacheKey, { data: result, timestamp: now });

    return result;
  } catch (error: any) {
    console.error('Error listing calendar events:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    if (error.message?.includes('quota') || error.message?.includes('rate limit')) {
      throw new HttpsError('resource-exhausted', 'Calendar API rate limit exceeded');
    }
    
    if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
      throw new HttpsError('unauthenticated', 'Calendar authentication expired - please reconnect');
    }
    
    throw new HttpsError('internal', 'Failed to list calendar events');
  }
});
