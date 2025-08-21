import * as admin from 'firebase-admin';
import { createSafeCallableFunction, SafeFunctionUtils, CostTracker } from './utils/safeFunctionTemplate';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Safe configuration for calendar/email functions
const SAFE_CONFIG = {
  MAX_API_CALLS_PER_MINUTE: 10,
  MAX_EVENTS_PER_REQUEST: 50,
  MAX_EMAILS_PER_REQUEST: 20,
  API_TIMEOUT_MS: 30000, // 30 seconds
  CACHE_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  MAX_EXECUTION_TIME_MS: 55000, // 55 seconds (under 60s limit)
};

// Cache for API responses to reduce calls
const apiCache = new Map<string, { data: any; timestamp: number }>();

/**
 * Circuit breaker check - top of every handler per playbook
 */
function checkCircuitBreaker(): void {
  if (process.env.CIRCUIT_BREAKER === 'on') {
    throw new Error('Circuit breaker is active - function execution blocked');
  }
}

/**
 * Clean up cache entries older than cache duration
 */
function cleanupCache(): void {
  const now = Date.now();
  for (const [key, value] of apiCache.entries()) {
    if (now - value.timestamp > SAFE_CONFIG.CACHE_DURATION_MS) {
      apiCache.delete(key);
    }
  }
}

/**
 * Safe version of getCalendarStatus with hardening playbook compliance
 */
export const getCalendarStatus = createSafeCallableFunction(async (request) => {
  // Circuit breaker check per playbook §2.1
  checkCircuitBreaker();
  
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  // Set up timeout per playbook §2.7
  const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('getCalendarStatus', 0.0001);

    // Clean up cache before checking
    cleanupCache();

    // Check cache first
    const cacheKey = `calendar_status_${userId}`;
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SAFE_CONFIG.CACHE_DURATION_MS) {
      console.log('Returning cached calendar status for user:', userId);
      return cached.data;
    }

    // Get user data with limits
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    
    const connected = !!(userData?.calendarConnected && userData?.calendarTokens?.access_token);
    const email = userData?.calendarTokens?.email || userData?.email;
    const lastSync = userData?.lastCalendarSync;
    const syncStatus = connected ? 'not_synced' : 'not_synced';

    const result = {
      connected,
      email,
      lastSync,
      syncStatus
    };

    // Cache the result
    apiCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Clean up cache if too large
    if (apiCache.size > 100) {
      const entries = Array.from(apiCache.entries());
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const newCache = new Map(entries.slice(0, 50));
      apiCache.clear();
      newCache.forEach((value, key) => apiCache.set(key, value));
    }

    const costSummary = CostTracker.getCostSummary();
    console.log(`Calendar status retrieved for user ${userId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return result;

  } catch (error) {
    console.error('Error getting Calendar status:', error);
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      connected: false,
      email: null,
      lastSync: null,
      syncStatus: 'error'
    };
  }
});

/**
 * Safe version of listCalendarEvents with hardening playbook compliance
 */
export const listCalendarEvents = createSafeCallableFunction(async (request) => {
  // Circuit breaker check per playbook §2.1
  checkCircuitBreaker();
  
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  // Set up timeout per playbook §2.7
  const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

  try {
    const { userId, maxResults = 50, timeMin, timeMax } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('listCalendarEvents', 0.001);

    // Limit max results for safety
    const safeMaxResults = Math.min(maxResults, SAFE_CONFIG.MAX_EVENTS_PER_REQUEST);

    // Get user's Calendar tokens with limits
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      throw new Error('Calendar not connected');
    }

    // Set up OAuth2 client with timeout
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials(userData.calendarTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client } as any);

    // Get events with retry logic and abort signal
    let eventsResponse;
    let retryCount = 0;

    while (retryCount < SAFE_CONFIG.MAX_RETRIES) {
      try {
        // Check abort signal
        if (abort.aborted) {
          throw new Error('Function execution timeout');
        }

        eventsResponse = await calendar.events.list({
          calendarId: 'primary',
          timeMin: timeMin || new Date().toISOString(),
          timeMax: timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          maxResults: safeMaxResults,
          singleEvents: true,
          orderBy: 'startTime'
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        retryCount++;
        if (retryCount >= SAFE_CONFIG.MAX_RETRIES) {
          throw error;
        }
        console.log(`Calendar API retry ${retryCount}/${SAFE_CONFIG.MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.RETRY_DELAY_MS * retryCount));
      }
    }

    const events = eventsResponse?.data.items?.map(event => ({
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

    const costSummary = CostTracker.getCostSummary();
    console.log(`Calendar events retrieved for user ${userId}, ${events.length} events, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return {
      success: true,
      events,
      totalEvents: events.length
    };

  } catch (error) {
    console.error('Error listing calendar events:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      events: [],
      totalEvents: 0
    };
  }
});

/**
 * Safe version of createCalendarEvent with hardening playbook compliance
 */
export const createCalendarEvent = createSafeCallableFunction(async (request) => {
  // Circuit breaker check per playbook §2.1
  checkCircuitBreaker();
  
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  // Set up timeout per playbook §2.7
  const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

  try {
    const { userId, eventData } = request.data;

    if (!userId || !eventData) {
      throw new Error('Missing required fields: userId, eventData');
    }

    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('createCalendarEvent', 0.002);

    // Validate event data
    if (!eventData.summary || !eventData.start || !eventData.end) {
      throw new Error('Missing required event fields: summary, start, end');
    }

    // Validate date formats
    const startDate = new Date(eventData.start);
    const endDate = new Date(eventData.end);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date format for start or end time');
    }

    if (startDate >= endDate) {
      throw new Error('Start time must be before end time');
    }

    // Get user's Calendar tokens with limits
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    if (!userData?.calendarTokens?.access_token) {
      throw new Error('Calendar not connected');
    }

    // Set up OAuth2 client with timeout
    const oauth2Client = new OAuth2Client();
    oauth2Client.setCredentials(userData.calendarTokens);
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client } as any);

    // Create event with retry logic and abort signal
    let event;
    let retryCount = 0;

    while (retryCount < SAFE_CONFIG.MAX_RETRIES) {
      try {
        // Check abort signal
        if (abort.aborted) {
          throw new Error('Function execution timeout');
        }

        event = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: eventData.summary,
            description: eventData.description || '',
            start: eventData.start,
            end: eventData.end,
            location: eventData.location || '',
            attendees: eventData.attendees || []
          }
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        retryCount++;
        if (retryCount >= SAFE_CONFIG.MAX_RETRIES) {
          throw error;
        }
        console.log(`Calendar API retry ${retryCount}/${SAFE_CONFIG.MAX_RETRIES}`);
        await new Promise(resolve => setTimeout(resolve, SAFE_CONFIG.RETRY_DELAY_MS * retryCount));
      }
    }

    const costSummary = CostTracker.getCostSummary();
    console.log(`Calendar event created for user ${userId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return {
      success: true,
      event: event?.data,
      message: 'Calendar event created successfully'
    };

  } catch (error) {
    console.error('Error creating calendar event:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      event: null,
      message: 'Failed to create calendar event'
    };
  }
});

/**
 * Safe version of getGmailStatus with hardening playbook compliance
 */
export const getGmailStatus = createSafeCallableFunction(async (request) => {
  // Circuit breaker check per playbook §2.1
  checkCircuitBreaker();
  
  SafeFunctionUtils.resetCounters();
  CostTracker.reset();

  // Set up timeout per playbook §2.7
  const abort = AbortSignal.timeout(SAFE_CONFIG.MAX_EXECUTION_TIME_MS);

  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    SafeFunctionUtils.checkSafetyLimits();
    CostTracker.trackOperation('getGmailStatus', 0.0001);

    // Clean up cache before checking
    cleanupCache();

    // Check cache first
    const cacheKey = `gmail_status_${userId}`;
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SAFE_CONFIG.CACHE_DURATION_MS) {
      console.log('Returning cached Gmail status for user:', userId);
      return cached.data;
    }

    // Get user data with limits
    const userDocRef = db.collection('users').doc(userId);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    
    const connected = !!(userData?.gmailConnected && userData?.gmailTokens?.access_token);
    const email = userData?.gmailTokens?.email || userData?.email;
    const lastSync = userData?.lastGmailSync;
    const syncStatus = connected ? 'not_synced' : 'not_synced';

    const result = {
      connected,
      email,
      lastSync,
      syncStatus
    };

    // Cache the result
    apiCache.set(cacheKey, { data: result, timestamp: Date.now() });

    const costSummary = CostTracker.getCostSummary();
    console.log(`Gmail status retrieved for user ${userId}, Cost: $${costSummary.estimatedCost.toFixed(4)}`);

    return result;

  } catch (error) {
    console.error('Error getting Gmail status:', error);
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      connected: false,
      email: null,
      lastSync: null,
      syncStatus: 'error'
    };
  }
});
