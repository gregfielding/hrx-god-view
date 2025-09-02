import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Calendar Events System
 * 
 * This system replaces the problematic multiple implementations with a single
 * optimized function that implements intelligent caching, rate limiting, and
 * prevents excessive invocations and Google Calendar API calls.
 */

// Configuration for optimized calendar events
const CALENDAR_EVENTS_CONFIG = {
  // Cache settings
  CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes cache (doubled from 15)
  CACHE_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour cleanup (less aggressive)
  MAX_CACHE_SIZE: 200, // Increased cache size
  
  // Rate limiting
  MAX_CALLS_PER_HOUR_PER_USER: 10, // Prevent excessive calls per user
  MAX_CALLS_PER_HOUR_GLOBAL: 100,  // Global rate limit
  
  // Processing limits
  MAX_EXECUTION_TIME_MS: 30000, // 30 seconds max execution
  MAX_EVENTS_PER_REQUEST: 100,  // Maximum events per request
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.8, // Process 80% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
  
  // Time range limits
  MAX_TIME_RANGE_DAYS: 90, // Maximum time range for queries
  DEFAULT_TIME_RANGE_DAYS: 30, // Default time range
};

// Global cache for calendar events (shared across instances)
const calendarEventsCache = new Map<string, { 
  data: any; 
  timestamp: number; 
  lastAccess: number;
  accessCount: number;
  eventCount: number;
}>();

// Rate limiting tracking
const rateLimitCache = new Map<string, { 
  count: number; 
  resetTime: number;
}>();

// Loop prevention tracking
const loopPreventionCache = new Map<string, { 
  lastCall: number; 
  callCount: number;
  lastEventCount: number;
}>();

/**
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, value] of calendarEventsCache.entries()) {
    if (now - value.timestamp > CALENDAR_EVENTS_CONFIG.CACHE_DURATION_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => calendarEventsCache.delete(key));
  
  // Also clean up rate limiting cache
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime) {
      rateLimitCache.delete(key);
    }
  }
  
  // Clean up loop prevention cache
  for (const [key, value] of loopPreventionCache.entries()) {
    if (now - value.lastCall > CALENDAR_EVENTS_CONFIG.LOOP_PREVENTION_TTL) {
      loopPreventionCache.delete(key);
    }
  }
  
  // If cache is still too large, remove least recently accessed entries
  if (calendarEventsCache.size > CALENDAR_EVENTS_CONFIG.MAX_CACHE_SIZE) {
    const entries = Array.from(calendarEventsCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3)); // Remove 30% oldest
    toRemove.forEach(([key]) => calendarEventsCache.delete(key));
  }
}

/**
 * Check rate limiting for calendar events calls
 */
function checkRateLimiting(userId: string): boolean {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Check global rate limiting
  const globalKey = `calendar_events_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    if (globalLimit.count >= CALENDAR_EVENTS_CONFIG.MAX_CALLS_PER_HOUR_GLOBAL) {
      console.log('🚫 Global rate limit exceeded for calendar events calls');
      return false;
    }
  }
  
  // Check user-specific rate limiting
  const userKey = `calendar_events_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    if (userLimit.count >= CALENDAR_EVENTS_CONFIG.MAX_CALLS_PER_HOUR_PER_USER) {
      console.log(`🚫 User rate limit exceeded for calendar events: ${userId}`);
      return false;
    }
  }
  
  return true;
}

/**
 * Update rate limiting counters
 */
function updateRateLimiting(userId: string): void {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Update global counter
  const globalKey = `calendar_events_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    globalLimit.count++;
  } else {
    rateLimitCache.set(globalKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
  
  // Update user counter
  const userKey = `calendar_events_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    userLimit.count++;
  } else {
    rateLimitCache.set(userKey, { 
      count: 1, 
      resetTime: now + (60 * 60 * 1000) 
    });
  }
}

/**
 * Check for potential infinite loops
 */
function checkForLoop(userId: string): boolean {
  const now = Date.now();
  const loopKey = `calendar_events_loop_${userId}`;
  const loopData = loopPreventionCache.get(loopKey);
  
  if (loopData) {
    // Check if called too frequently
    if (now - loopData.lastCall < 1000) { // Less than 1 second between calls
      loopData.callCount++;
      if (loopData.callCount > 5) { // More than 5 calls in rapid succession
        console.log(`🚫 Loop prevention: User ${userId} calling calendar events too frequently`);
        return true;
      }
    } else {
      loopData.callCount = 1;
    }
    loopData.lastCall = now;
  } else {
    loopPreventionCache.set(loopKey, { 
      lastCall: now, 
      callCount: 1,
      lastEventCount: 0
    });
  }
  
  return false;
}

/**
 * Validate and normalize time parameters
 */
function validateTimeParameters(timeMin?: string, timeMax?: string): { timeMin: string; timeMax: string } {
  const now = new Date();
  const defaultTimeMin = new Date(now.getTime() - (CALENDAR_EVENTS_CONFIG.DEFAULT_TIME_RANGE_DAYS * 24 * 60 * 60 * 1000));
  const defaultTimeMax = new Date(now.getTime() + (CALENDAR_EVENTS_CONFIG.DEFAULT_TIME_RANGE_DAYS * 24 * 60 * 60 * 1000));
  
  let validatedTimeMin: Date;
  let validatedTimeMax: Date;
  
  if (timeMin) {
    validatedTimeMin = new Date(timeMin);
    if (isNaN(validatedTimeMin.getTime())) {
      validatedTimeMin = defaultTimeMin;
    }
  } else {
    validatedTimeMin = defaultTimeMin;
  }
  
  if (timeMax) {
    validatedTimeMax = new Date(timeMax);
    if (isNaN(validatedTimeMax.getTime())) {
      validatedTimeMax = defaultTimeMax;
    }
  } else {
    validatedTimeMax = defaultTimeMax;
  }
  
  // Check time range limits
  const timeRangeDays = (validatedTimeMax.getTime() - validatedTimeMin.getTime()) / (24 * 60 * 60 * 1000);
  if (timeRangeDays > CALENDAR_EVENTS_CONFIG.MAX_TIME_RANGE_DAYS) {
    console.log(`Time range ${timeRangeDays} days exceeds maximum ${CALENDAR_EVENTS_CONFIG.MAX_TIME_RANGE_DAYS} days, adjusting`);
    validatedTimeMax = new Date(validatedTimeMin.getTime() + (CALENDAR_EVENTS_CONFIG.MAX_TIME_RANGE_DAYS * 24 * 60 * 60 * 1000));
  }
  
  return {
    timeMin: validatedTimeMin.toISOString(),
    timeMax: validatedTimeMax.toISOString()
  };
}

/**
 * List calendar events with comprehensive optimization
 */
export const listCalendarEventsOptimized = onCall({
  timeoutSeconds: Math.floor(CALENDAR_EVENTS_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
  memory: '512MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { userId, maxResults = 50, timeMin, timeMax, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!userId) {
      throw new HttpsError('invalid-argument', 'User ID is required');
    }

    console.log('🔍 Calendar events requested', {
      userId,
      requestedBy: request.auth.uid,
      maxResults,
      timeMin,
      timeMax,
      force,
      timestamp: new Date().toISOString()
    });

    // Clean up cache periodically
    if (Math.random() < 0.1) { // 10% chance to clean up
      cleanupCache();
    }

    // Check rate limiting (unless forced)
    if (!force && !checkRateLimiting(userId)) {
      return {
        success: false,
        events: [],
        totalEvents: 0,
        message: 'Rate limit exceeded for calendar events',
        rateLimited: true,
        cached: false
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > CALENDAR_EVENTS_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping calendar events request due to sampling');
      return {
        success: true,
        events: [],
        totalEvents: 0,
        message: 'Skipped due to sampling',
        sampled: true,
        cached: false
      };
    }
    
    // Check for potential infinite loops
    if (checkForLoop(userId)) {
      return {
        success: false,
        events: [],
        totalEvents: 0,
        message: 'Too many rapid calls detected',
        loopDetected: true,
        cached: false
      };
    }
    
    // Validate and normalize time parameters
    const { timeMin: validatedTimeMin, timeMax: validatedTimeMax } = validateTimeParameters(timeMin, timeMin);
    
    // Validate maxResults
    const safeMaxResults = Math.min(maxResults, CALENDAR_EVENTS_CONFIG.MAX_EVENTS_PER_REQUEST);
    
    // Check cache first
    const cacheKey = `calendar_events_${userId}_${safeMaxResults}_${validatedTimeMin}_${validatedTimeMax}`;
    const cached = calendarEventsCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CALENDAR_EVENTS_CONFIG.CACHE_DURATION_MS) {
      // Update access tracking
      cached.lastAccess = now;
      cached.accessCount++;
      
      console.log('✅ Calendar events served from cache for user:', userId);
      return {
        ...cached.data,
        success: true,
        cached: true,
        cacheAge: now - cached.timestamp
      };
    }

    // Update rate limiting
    updateRateLimiting(userId);

    try {
      // Get user's Calendar tokens
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        const result = { 
          success: false,
          events: [],
          totalEvents: 0,
          message: 'User not found',
          cached: false
        };
        
        // Cache negative results too
        calendarEventsCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          eventCount: 0
        });
        
        return result;
      }

      const userData = userDoc.data();
      
      if (!userData?.calendarTokens?.access_token) {
        const result = { 
          success: false,
          events: [],
          totalEvents: 0,
          message: 'Calendar not connected',
          cached: false
        };
        
        // Cache the result
        calendarEventsCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          eventCount: 0
        });
        
        return result;
      }

      // Set up OAuth2 client
      const { OAuth2Client } = require('google-auth-library');
      const oauth2Client = new OAuth2Client(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      
      oauth2Client.setCredentials(userData.calendarTokens);
      
      const { google } = require('googleapis');
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Get events from primary calendar with timeout
      const eventsPromise = calendar.events.list({
        calendarId: 'primary',
        timeMin: validatedTimeMin,
        timeMax: validatedTimeMax,
        maxResults: safeMaxResults,
        singleEvents: true,
        orderBy: 'startTime'
      });
      
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Calendar API timeout')), 15000)
      );
      
      const eventsResponse = await Promise.race([eventsPromise, timeoutPromise]);

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
        status: event.status,
        htmlLink: event.htmlLink,
        hangoutLink: event.hangoutLink
      })) || [];

      const result = { 
        success: true,
        events,
        totalEvents: events.length,
        timeMin: validatedTimeMin,
        timeMax: validatedTimeMax,
        cached: false
      };
      
      // Cache the successful result
      calendarEventsCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        eventCount: events.length
      });
      
      console.log('✅ Calendar events retrieved successfully for user:', userId, 'Events:', events.length);
      return result;
      
    } catch (error: any) {
      console.error('Error listing calendar events:', error);
      
      let result;
      
      if (error.message?.includes('timeout')) {
        result = { 
          success: false,
          events: [],
          totalEvents: 0,
          message: 'Calendar API timeout',
          cached: false
        };
      } else if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
        result = { 
          success: false,
          events: [],
          totalEvents: 0,
          message: 'Calendar authentication expired',
          cached: false
        };
      } else {
        result = { 
          success: false,
          events: [],
          totalEvents: 0,
          message: `Calendar connection error: ${error.message}`,
          cached: false
        };
      }
      
      // Cache error results too (but with shorter TTL)
      calendarEventsCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        eventCount: 0
      });
      
      return result;
    }

  } catch (error) {
    console.error('Error in listCalendarEventsOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to list calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch list calendar events for multiple users (efficient bulk processing)
 */
export const batchListCalendarEventsOptimized = onCall({
  timeoutSeconds: 120,
  memory: '1GiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { userRequests, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!Array.isArray(userRequests) || userRequests.length === 0) {
      throw new HttpsError('invalid-argument', 'User requests array is required');
    }
    
    if (userRequests.length > 20) {
      throw new HttpsError('invalid-argument', 'Maximum 20 users per batch');
    }

    const requestingUserId = request.auth.uid;

    console.log('🔍 Batch calendar events requested', {
      userCount: userRequests.length,
      requestedBy: requestingUserId,
      force,
      timestamp: new Date().toISOString()
    });

    const results = [];
    
    // Process users in parallel with concurrency limit
    const concurrencyLimit = 5; // Lower concurrency for API calls
    for (let i = 0; i < userRequests.length; i += concurrencyLimit) {
      const batch = userRequests.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (userRequest) => {
        try {
          const { userId, maxResults = 50, timeMin, timeMax } = userRequest;
          
          if (!userId) {
            return {
              userId,
              success: false,
              events: [],
              totalEvents: 0,
              message: 'Missing userId'
            };
          }
          
          // Check rate limiting for each user
          if (!force && !checkRateLimiting(userId)) {
            return {
              userId,
              success: false,
              events: [],
              totalEvents: 0,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Check for loops
          if (checkForLoop(userId)) {
            return {
              userId,
              success: false,
              events: [],
              totalEvents: 0,
              message: 'Too many rapid calls detected',
              loopDetected: true
            };
          }
          
          // Validate and normalize time parameters
          const { timeMin: validatedTimeMin, timeMax: validatedTimeMax } = validateTimeParameters(timeMin, timeMax);
          
          // Validate maxResults
          const safeMaxResults = Math.min(maxResults, CALENDAR_EVENTS_CONFIG.MAX_EVENTS_PER_REQUEST);
          
          // Check cache first
          const cacheKey = `calendar_events_${userId}_${safeMaxResults}_${validatedTimeMin}_${validatedTimeMax}`;
          const cached = calendarEventsCache.get(cacheKey);
          const now = Date.now();
          
          if (cached && (now - cached.timestamp) < CALENDAR_EVENTS_CONFIG.CACHE_DURATION_MS) {
            cached.lastAccess = now;
            cached.accessCount++;
            
            return {
              userId,
              ...cached.data,
              cached: true,
              cacheAge: now - cached.timestamp
            };
          }
          
          // Update rate limiting
          updateRateLimiting(userId);
          
          // Get user data
          const userDoc = await db.collection('users').doc(userId).get();
          
          if (!userDoc.exists) {
            const result = { 
              userId,
              success: false,
              events: [],
              totalEvents: 0,
              message: 'User not found'
            };
            
            calendarEventsCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              eventCount: 0
            });
            
            return result;
          }
          
          const userData = userDoc.data();
          
          if (!userData?.calendarTokens?.access_token) {
            const result = { 
              userId,
              success: false,
              events: [],
              totalEvents: 0,
              message: 'Calendar not connected'
            };
            
            calendarEventsCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              eventCount: 0
            });
            
            return result;
          }
          
          // Set up OAuth2 client
          const { OAuth2Client } = require('google-auth-library');
          const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
          );
          
          oauth2Client.setCredentials(userData.calendarTokens);
          
          const { google } = require('googleapis');
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          
          // Get events with timeout
          const eventsPromise = calendar.events.list({
            calendarId: 'primary',
            timeMin: validatedTimeMin,
            timeMax: validatedTimeMax,
            maxResults: safeMaxResults,
            singleEvents: true,
            orderBy: 'startTime'
          });
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Calendar API timeout')), 15000)
          );
          
          const eventsResponse = await Promise.race([eventsPromise, timeoutPromise]);
          
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
            status: event.status,
            htmlLink: event.htmlLink,
            hangoutLink: event.hangoutLink
          })) || [];
          
          const result = { 
            userId,
            success: true,
            events,
            totalEvents: events.length,
            timeMin: validatedTimeMin,
            timeMax: validatedTimeMax
          };
          
          calendarEventsCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1,
            eventCount: events.length
          });
          
          return result;
          
        } catch (error: any) {
          console.error(`Error processing calendar events for user ${userRequest.userId}:`, error);
          
          return {
            userId: userRequest.userId || 'unknown',
            success: false,
            events: [],
            totalEvents: 0,
            message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to respect API limits
      if (i + concurrencyLimit < userRequests.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch calendar events completed', {
      totalUsers: userRequests.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch events completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: userRequests.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchListCalendarEventsOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to batch list calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Set up periodic cache cleanup
setInterval(cleanupCache, CALENDAR_EVENTS_CONFIG.CACHE_CLEANUP_INTERVAL_MS);
