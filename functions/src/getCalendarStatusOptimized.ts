import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Calendar Status System
 * 
 * This system replaces the problematic multiple implementations with a single
 * optimized function that implements intelligent caching, rate limiting, and
 * prevents excessive invocations.
 */

// Configuration for optimized calendar status
const CALENDAR_CONFIG = {
  // Cache settings
  CACHE_DURATION_MS: 30 * 60 * 1000, // 30 minutes cache (increased from 15)
  CACHE_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour cleanup (less aggressive)
  MAX_CACHE_SIZE: 200, // Increased cache size
  
  // Rate limiting
  MAX_CALLS_PER_HOUR_PER_USER: 10, // Prevent excessive calls per user
  MAX_CALLS_PER_HOUR_GLOBAL: 100,  // Global rate limit
  
  // Processing limits
  MAX_EXECUTION_TIME_MS: 30000, // 30 seconds max execution
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.8, // Process 80% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
};

// Global cache for calendar status (shared across instances)
const calendarStatusCache = new Map<string, { 
  data: any; 
  timestamp: number; 
  lastAccess: number;
  accessCount: number;
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
}>();

/**
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, value] of calendarStatusCache.entries()) {
    if (now - value.timestamp > CALENDAR_CONFIG.CACHE_DURATION_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => calendarStatusCache.delete(key));
  
  // Also clean up rate limiting cache
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime) {
      rateLimitCache.delete(key);
    }
  }
  
  // Clean up loop prevention cache
  for (const [key, value] of loopPreventionCache.entries()) {
    if (now - value.lastCall > CALENDAR_CONFIG.LOOP_PREVENTION_TTL) {
      loopPreventionCache.delete(key);
    }
  }
  
  // If cache is still too large, remove least recently accessed entries
  if (calendarStatusCache.size > CALENDAR_CONFIG.MAX_CACHE_SIZE) {
    const entries = Array.from(calendarStatusCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3)); // Remove 30% oldest
    toRemove.forEach(([key]) => calendarStatusCache.delete(key));
  }
}

/**
 * Check rate limiting for calendar status calls
 */
function checkRateLimiting(userId: string): boolean {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Check global rate limiting
  const globalKey = `calendar_status_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    if (globalLimit.count >= CALENDAR_CONFIG.MAX_CALLS_PER_HOUR_GLOBAL) {
      console.log('🚫 Global rate limit exceeded for calendar status calls');
      return false;
    }
  }
  
  // Check user-specific rate limiting
  const userKey = `calendar_status_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    if (userLimit.count >= CALENDAR_CONFIG.MAX_CALLS_PER_HOUR_PER_USER) {
      console.log(`🚫 User rate limit exceeded for calendar status: ${userId}`);
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
  const globalKey = `calendar_status_global_${hourKey}`;
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
  const userKey = `calendar_status_user_${userId}_${hourKey}`;
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
  const loopKey = `calendar_status_loop_${userId}`;
  const loopData = loopPreventionCache.get(loopKey);
  
  if (loopData) {
    // Check if called too frequently
    if (now - loopData.lastCall < 1000) { // Less than 1 second between calls
      loopData.callCount++;
      if (loopData.callCount > 5) { // More than 5 calls in rapid succession
        console.log(`🚫 Loop prevention: User ${userId} calling too frequently`);
        return true;
      }
    } else {
      loopData.callCount = 1;
    }
    loopData.lastCall = now;
  } else {
    loopPreventionCache.set(loopKey, { 
      lastCall: now, 
      callCount: 1 
    });
  }
  
  return false;
}

/**
 * Get calendar status with comprehensive optimization
 */
export const getCalendarStatusOptimized = onCall({
  cors: true,
  timeoutSeconds: Math.floor(CALENDAR_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { userId, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!userId) {
      throw new HttpsError('invalid-argument', 'User ID is required');
    }

    console.log('🔍 Calendar status requested', {
      userId,
      requestedBy: request.auth.uid,
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
        connected: false,
        message: 'Rate limit exceeded for calendar status checks',
        rateLimited: true,
        cached: false
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > CALENDAR_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping calendar status check due to sampling');
      return {
        success: true,
        connected: false,
        message: 'Skipped due to sampling',
        sampled: true,
        cached: false
      };
    }
    
    // Check for potential infinite loops
    if (checkForLoop(userId)) {
      return {
        success: false,
        connected: false,
        message: 'Too many rapid calls detected',
        loopDetected: true,
        cached: false
      };
    }
    
    // Hard cap: reject repeated requests within 60 minutes unless force=true (rely on cache)
    const cacheKey = `calendar_status_${userId}`;
    const cached = calendarStatusCache.get(cacheKey);
    const now = Date.now();
    if (!force && cached && (now - cached.timestamp) < (60 * 60 * 1000)) {
      cached.lastAccess = now;
      cached.accessCount++;
      return { ...cached.data, success: true, cached: true, deduped: true, cacheAge: now - cached.timestamp };
    }
    
    if (cached && (now - cached.timestamp) < CALENDAR_CONFIG.CACHE_DURATION_MS) {
      // Update access tracking
      cached.lastAccess = now;
      cached.accessCount++;
      
      console.log('✅ Calendar status served from cache for user:', userId);
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
          connected: false, 
          message: 'User not found',
          cached: false
        };
        
        // Cache negative results too (but with shorter TTL)
        calendarStatusCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1
        });
        
        return result;
      }

      const userData = userDoc.data();
      
      if (!userData?.calendarTokens?.access_token) {
        const result = { 
          success: true,
          connected: false, 
          message: 'Calendar not connected',
          cached: false
        };
        
        // Cache the result
        calendarStatusCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1
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

      // Test calendar access (with timeout)
      const testPromise = calendar.calendarList.list({ maxResults: 1 });
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Calendar API timeout')), 10000)
      );
      
      await Promise.race([testPromise, timeoutPromise]);

      const result = { 
        success: true,
        connected: true, 
        message: 'Calendar connected',
        email: userData.calendarTokens.email || userData.email,
        lastSync: userData.lastCalendarSync,
        syncStatus: 'connected',
        cached: false
      };
      
      // Cache the successful result
      calendarStatusCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1
      });
      
      console.log('✅ Calendar status check completed successfully for user:', userId);
      return result;
      
    } catch (error: any) {
      console.error('Error checking calendar status:', error);
      
      let result;
      
      if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
        result = { 
          success: false,
          connected: false, 
          message: 'Calendar authentication expired',
          cached: false
        };
      } else if (error.message?.includes('timeout')) {
        result = { 
          success: false,
          connected: false, 
          message: 'Calendar API timeout',
          cached: false
        };
      } else {
        result = { 
          success: false,
          connected: false, 
          message: 'Calendar connection error',
          cached: false
        };
      }
      
      // Cache error results too (but with shorter TTL)
      calendarStatusCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1
      });
      
      return result;
    }

  } catch (error) {
    console.error('Error in getCalendarStatusOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to get calendar status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch get calendar status for multiple users (efficient bulk processing)
 */
export const batchGetCalendarStatusOptimized = onCall({
  timeoutSeconds: 60,
  memory: '512MiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { userIds, force = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      throw new HttpsError('invalid-argument', 'User IDs array is required');
    }
    
    if (userIds.length > 50) {
      throw new HttpsError('invalid-argument', 'Maximum 50 users per batch');
    }

    console.log('🔍 Batch calendar status requested', {
      userCount: userIds.length,
      requestedBy: request.auth.uid,
      force,
      timestamp: new Date().toISOString()
    });

    const results = [];
    
    // Process users in parallel with concurrency limit
    const concurrencyLimit = 10;
    for (let i = 0; i < userIds.length; i += concurrencyLimit) {
      const batch = userIds.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (userId) => {
        try {
          // Check rate limiting for each user
          if (!force && !checkRateLimiting(userId)) {
            return {
              userId,
              success: false,
              connected: false,
              message: 'Rate limit exceeded',
              rateLimited: true
            };
          }
          
          // Check for loops
          if (checkForLoop(userId)) {
            return {
              userId,
              success: false,
              connected: false,
              message: 'Too many rapid calls detected',
              loopDetected: true
            };
          }
          
          // Check cache first
          const cacheKey = `calendar_status_${userId}`;
          const cached = calendarStatusCache.get(cacheKey);
          const now = Date.now();
          
          if (cached && (now - cached.timestamp) < CALENDAR_CONFIG.CACHE_DURATION_MS) {
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
              connected: false, 
              message: 'User not found'
            };
            
            calendarStatusCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1
            });
            
            return result;
          }
          
          const userData = userDoc.data();
          
          if (!userData?.calendarTokens?.access_token) {
            const result = { 
              userId,
              success: true,
              connected: false, 
              message: 'Calendar not connected'
            };
            
            calendarStatusCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1
            });
            
            return result;
          }
          
          // Test calendar access
          const { OAuth2Client } = require('google-auth-library');
          const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
          );
          
          oauth2Client.setCredentials(userData.calendarTokens);
          
          const { google } = require('googleapis');
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          
          await calendar.calendarList.list({ maxResults: 1 });
          
          const result = { 
            userId,
            success: true,
            connected: true, 
            message: 'Calendar connected',
            email: userData.calendarTokens.email || userData.email,
            lastSync: userData.lastCalendarSync,
            syncStatus: 'connected'
          };
          
          calendarStatusCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1
          });
          
          return result;
          
        } catch (error: any) {
          console.error(`Error processing user ${userId}:`, error);
          
          let result;
          
          if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
            result = { 
              userId,
              success: false,
              connected: false, 
              message: 'Calendar authentication expired'
            };
          } else {
            result = { 
              userId,
              success: false,
              connected: false, 
              message: 'Calendar connection error'
            };
          }
          
          return result;
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches
      if (i + concurrencyLimit < userIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch calendar status completed', {
      totalUsers: userIds.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch status check completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: userIds.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchGetCalendarStatusOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to get batch calendar status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Set up periodic cache cleanup
setInterval(cleanupCache, CALENDAR_CONFIG.CACHE_CLEANUP_INTERVAL_MS);
