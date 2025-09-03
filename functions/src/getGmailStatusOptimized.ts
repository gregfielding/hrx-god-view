import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { logAIAction } from './utils/aiLogging';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Optimized Gmail Status System
 * 
 * This system replaces the problematic multiple implementations with a single
 * optimized function that implements intelligent caching, rate limiting, and
 * prevents excessive invocations and Google Gmail API calls.
 */

// Configuration for optimized Gmail status
const GMAIL_STATUS_CONFIG = {
  // Cache settings
  CACHE_DURATION_MS: 90 * 60 * 1000, // 90 minutes cache (align with calendar)
  CACHE_CLEANUP_INTERVAL_MS: 60 * 60 * 1000, // 1 hour cleanup (less aggressive)
  MAX_CACHE_SIZE: 200, // Increased cache size
  
  // Rate limiting
  MAX_CALLS_PER_HOUR_PER_USER: 1, // Stricter: 1 call per hour per user
  MAX_CALLS_PER_HOUR_GLOBAL: 30,  // Global rate limit tightened
  
  // Processing limits
  MAX_EXECUTION_TIME_MS: 30000, // 30 seconds max execution
  
  // Sampling for high-volume operations
  SAMPLING_RATE: 0.8, // Process 80% of requests during high volume
  
  // Loop prevention
  LOOP_PREVENTION_TTL: 5 * 60 * 1000, // 5 minutes loop prevention
  
  // Gmail API specific
  GMAIL_API_TIMEOUT_MS: 15000, // 15 seconds timeout for Gmail API calls
  MAX_RETRIES: 2, // Maximum retries for Gmail API calls
  RETRY_DELAY_MS: 1000, // Delay between retries
  // Server-side dedupe window shared across instances
  DEDUPE_WINDOW_MS: 90 * 60 * 1000, // 90 minutes
};

// Global cache for Gmail status (shared across instances)
const gmailStatusCache = new Map<string, { 
  data: any; 
  timestamp: number; 
  lastAccess: number;
  accessCount: number;
  lastGmailApiCall: number;
  gmailApiCallCount: number;
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
  lastStatus: string;
}>();

/**
 * Clean up expired cache entries
 */
function cleanupCache(): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, value] of gmailStatusCache.entries()) {
    if (now - value.timestamp > GMAIL_STATUS_CONFIG.CACHE_DURATION_MS) {
      expiredKeys.push(key);
    }
  }
  
  expiredKeys.forEach(key => gmailStatusCache.delete(key));
  
  // Also clean up rate limiting cache
  for (const [key, value] of rateLimitCache.entries()) {
    if (now > value.resetTime) {
      rateLimitCache.delete(key);
    }
  }
  
  // Clean up loop prevention cache
  for (const [key, value] of loopPreventionCache.entries()) {
    if (now - value.lastCall > GMAIL_STATUS_CONFIG.LOOP_PREVENTION_TTL) {
      loopPreventionCache.delete(key);
    }
  }
  
  // If cache is still too large, remove least recently accessed entries
  if (gmailStatusCache.size > GMAIL_STATUS_CONFIG.MAX_CACHE_SIZE) {
    const entries = Array.from(gmailStatusCache.entries());
    entries.sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.3)); // Remove 30% oldest
    toRemove.forEach(([key]) => gmailStatusCache.delete(key));
  }
}

/**
 * Check rate limiting for Gmail status calls
 */
function checkRateLimiting(userId: string): boolean {
  const now = Date.now();
  const hourKey = Math.floor(now / (60 * 60 * 1000));
  
  // Check global rate limiting
  const globalKey = `gmail_status_global_${hourKey}`;
  const globalLimit = rateLimitCache.get(globalKey);
  
  if (globalLimit) {
    if (globalLimit.count >= GMAIL_STATUS_CONFIG.MAX_CALLS_PER_HOUR_GLOBAL) {
      console.log('🚫 Global rate limit exceeded for Gmail status calls');
      return false;
    }
  }
  
  // Check user-specific rate limiting
  const userKey = `gmail_status_user_${userId}_${hourKey}`;
  const userLimit = rateLimitCache.get(userKey);
  
  if (userLimit) {
    if (userLimit.count >= GMAIL_STATUS_CONFIG.MAX_CALLS_PER_HOUR_PER_USER) {
      console.log(`🚫 User rate limit exceeded for Gmail status: ${userId}`);
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
  const globalKey = `gmail_status_global_${hourKey}`;
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
  const userKey = `gmail_status_user_${userId}_${hourKey}`;
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
  const loopKey = `gmail_status_loop_${userId}`;
  const loopData = loopPreventionCache.get(loopKey);
  
  if (loopData) {
    // Check if called too frequently
    if (now - loopData.lastCall < 1000) { // Less than 1 second between calls
      loopData.callCount++;
      if (loopData.callCount > 5) { // More than 5 calls in rapid succession
        console.log(`🚫 Loop prevention: User ${userId} calling Gmail status too frequently`);
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
      lastStatus: 'unknown'
    });
  }
  
  return false;
}

/**
 * Test Gmail API access with timeout and retries
 */
async function testGmailAccess(userData: any): Promise<{ connected: boolean; email?: string; error?: string }> {
  try {
    // Set up OAuth2 client
    const { OAuth2Client } = require('google-auth-library');
    const oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    oauth2Client.setCredentials(userData.gmailTokens);
    
    const { google } = require('googleapis');
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test Gmail access with timeout
    const testPromise = gmail.users.getProfile({ userId: 'me' });
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Gmail API timeout')), GMAIL_STATUS_CONFIG.GMAIL_API_TIMEOUT_MS)
    );
    
    const response = await Promise.race([testPromise, timeoutPromise]);
    
    return {
      connected: true,
      email: response.data.emailAddress
    };
    
  } catch (error: any) {
    console.error('Gmail API test failed:', error);
    
    if (error.message?.includes('timeout')) {
      return { connected: false, error: 'Gmail API timeout' };
    } else if (error.message?.includes('invalid_grant') || error.message?.includes('token')) {
      return { connected: false, error: 'Gmail authentication expired' };
    } else {
      return { connected: false, error: `Gmail connection error: ${error.message}` };
    }
  }
}

/**
 * Get Gmail status with comprehensive optimization
 */
export const getGmailStatusOptimized = onCall({
  timeoutSeconds: Math.floor(GMAIL_STATUS_CONFIG.MAX_EXECUTION_TIME_MS / 1000),
  memory: '256MiB',
  maxInstances: 5
}, async (request) => {
  try {
    const { userId, force = false, testConnection = false } = request.data || {};
    
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    
    if (!userId) {
      throw new HttpsError('invalid-argument', 'User ID is required');
    }

    console.log('🔍 Gmail status requested', {
      userId,
      requestedBy: request.auth.uid,
      force,
      testConnection,
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
        email: null,
        lastSync: null,
        syncStatus: 'rate_limited',
        message: 'Rate limit exceeded for Gmail status',
        rateLimited: true,
        cached: false
      };
    }
    
    // Apply sampling for high-volume operations (unless forced)
    if (!force && Math.random() > GMAIL_STATUS_CONFIG.SAMPLING_RATE) {
      console.log('📊 Skipping Gmail status request due to sampling');
      return {
        success: true,
        connected: false,
        email: null,
        lastSync: null,
        syncStatus: 'sampled',
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
        email: null,
        lastSync: null,
        syncStatus: 'loop_detected',
        message: 'Too many rapid calls detected',
        loopDetected: true,
        cached: false
      };
    }
    
    // Hard cap: reject repeated requests within 60 minutes unless force=true
    const now = Date.now();
    const dedupeKey = `gmail_status_dedupe_${userId}`;
    const dedupeRef = db.collection('ai_cache').doc(dedupeKey);
    const dedupeSnap = await dedupeRef.get();
    if (!force && !testConnection && dedupeSnap.exists) {
      const dd = dedupeSnap.data() as any;
      const updatedAt = dd.updatedAt?.toMillis ? dd.updatedAt.toMillis() : (typeof dd.updatedAt === 'number' ? dd.updatedAt : 0);
      if (updatedAt && (now - updatedAt) < (60 * 60 * 1000) && dd.payload) { // 60-minute hard cap
        try { if (Math.random() < 0.1) { await logAIAction({ eventType: 'gmail.status.deduped', targetType: 'user', targetId: userId, reason: 'deduped_90m', contextType: 'integrations', aiTags: ['gmail','status','dedupe'], urgencyScore: 2, tenantId: '', aiResponse: JSON.stringify(dd.payload) }); } } catch {}
        return { ...dd.payload, success: true, cached: true, deduped: true, cacheAge: now - updatedAt };
      }
    }

    // Check in-memory cache next (unless forced or testing connection)
    const cacheKey = `gmail_status_${userId}`;
    const cached = gmailStatusCache.get(cacheKey);
    
    if (cached && !force && !testConnection && (now - cached.timestamp) < GMAIL_STATUS_CONFIG.CACHE_DURATION_MS) {
      // Update access tracking
      cached.lastAccess = now;
      cached.accessCount++;
      
      console.log('✅ Gmail status served from cache for user:', userId);
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
      // Get user data
      const userDoc = await db.collection('users').doc(userId).get();
      
      if (!userDoc.exists) {
        const result = { 
          success: false,
          connected: false,
          email: null,
          lastSync: null,
          syncStatus: 'user_not_found',
          message: 'User not found',
          cached: false
        };
        
        // Cache negative results too
        gmailStatusCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          lastGmailApiCall: 0,
          gmailApiCallCount: 0
        });
        
        return result;
      }

      const userData = userDoc.data();
      
      // Check if user has Gmail tokens
      if (!userData?.gmailTokens?.access_token) {
        const result = { 
          success: true,
          connected: false,
          email: null,
          lastSync: null,
          syncStatus: 'not_connected',
          message: 'Gmail not connected',
          cached: false
        };
        
        // Cache the result
        gmailStatusCache.set(cacheKey, { 
          data: result, 
          timestamp: now,
          lastAccess: now,
          accessCount: 1,
          lastGmailApiCall: 0,
          gmailApiCallCount: 0
        });
        
        return result;
      }

      // If testing connection or forced, make actual Gmail API call
      if (testConnection || force) {
        const gmailTest = await testGmailAccess(userData);
        
        if (gmailTest.connected) {
          const result = { 
            success: true,
            connected: true,
            email: gmailTest.email || userData.gmailTokens.email || userData.email,
            lastSync: userData.lastGmailSync || null,
            syncStatus: 'connected',
            message: 'Gmail connected and accessible',
            cached: false
          };
          
          // Cache the successful result
          gmailStatusCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1,
            lastGmailApiCall: now,
            gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1
          });
          
          console.log('✅ Gmail status verified via API for user:', userId);
          try { await dedupeRef.set({ payload: result, updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastGmailApiCall: now, gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1 }, { merge: true }); } catch {}
          return result;
          
        } else {
          const result = { 
            success: false,
            connected: false,
            email: userData.gmailTokens.email || userData.email,
            lastSync: userData.lastGmailSync || null,
            syncStatus: 'connection_error',
            message: gmailTest.error || 'Gmail connection failed',
            cached: false
          };
          
          // Cache the error result
          gmailStatusCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1,
            lastGmailApiCall: now,
            gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1
          });
          
          try { await dedupeRef.set({ payload: result, updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastGmailApiCall: now, gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1 }, { merge: true }); } catch {}
          return result;
        }
      }
      
      // For regular status checks, return cached connection status without API calls
      const result = { 
        success: true,
        connected: true,
        email: userData.gmailTokens.email || userData.email,
        lastSync: userData.lastGmailSync || null,
        syncStatus: 'connected',
        message: 'Gmail connected (cached status)',
        cached: false
      };
      
      // Cache the result
      gmailStatusCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        lastGmailApiCall: cached?.lastGmailApiCall || 0,
        gmailApiCallCount: cached?.gmailApiCallCount || 0
      });
      try { await dedupeRef.set({ payload: result, updatedAt: admin.firestore.FieldValue.serverTimestamp(), lastGmailApiCall: cached?.lastGmailApiCall || 0, gmailApiCallCount: cached?.gmailApiCallCount || 0 }, { merge: true }); } catch {}
      
      console.log('✅ Gmail status retrieved from user data for user:', userId);
      return result;
      
    } catch (error: any) {
      console.error('Error getting Gmail status:', error);
      
      const result = { 
        success: false,
        connected: false,
        email: null,
        lastSync: null,
        syncStatus: 'error',
        message: `Failed to get Gmail status: ${error.message}`,
        cached: false
      };
      
      // Cache error results too (but with shorter TTL)
      gmailStatusCache.set(cacheKey, { 
        data: result, 
        timestamp: now,
        lastAccess: now,
        accessCount: 1,
        lastGmailApiCall: cached?.lastGmailApiCall || 0,
        gmailApiCallCount: cached?.gmailApiCallCount || 0
      });
      
      return result;
    }

  } catch (error) {
    console.error('Error in getGmailStatusOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to get Gmail status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Batch get Gmail status for multiple users (efficient bulk processing)
 */
export const batchGetGmailStatusOptimized = onCall({
  timeoutSeconds: 60,
  memory: '512MiB',
  maxInstances: 3
}, async (request) => {
  try {
    const { userRequests, force = false, testConnection = false } = request.data || {};
    
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

    console.log('🔍 Batch Gmail status requested', {
      userCount: userRequests.length,
      requestedBy: requestingUserId,
      force,
      testConnection,
      timestamp: new Date().toISOString()
    });

    const results = [];
    
    // Process users in parallel with concurrency limit
    const concurrencyLimit = 10; // Higher concurrency for status checks
    for (let i = 0; i < userRequests.length; i += concurrencyLimit) {
      const batch = userRequests.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async (userRequest) => {
        try {
          const { userId } = userRequest;
          
          if (!userId) {
            return {
              userId,
              success: false,
              connected: false,
              email: null,
              lastSync: null,
              syncStatus: 'missing_user_id',
              message: 'Missing userId'
            };
          }
          
          // Check rate limiting for each user
          if (!force && !checkRateLimiting(userId)) {
            return {
              userId,
              success: false,
              connected: false,
              email: null,
              lastSync: null,
              syncStatus: 'rate_limited',
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
              email: null,
              lastSync: null,
              syncStatus: 'loop_detected',
              message: 'Too many rapid calls detected',
              loopDetected: true
            };
          }
          
          // Check cache first
          const cacheKey = `gmail_status_${userId}`;
          const cached = gmailStatusCache.get(cacheKey);
          const now = Date.now();
          
          if (cached && !force && !testConnection && (now - cached.timestamp) < GMAIL_STATUS_CONFIG.CACHE_DURATION_MS) {
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
              email: null,
              lastSync: null,
              syncStatus: 'user_not_found',
              message: 'User not found'
            };
            
            gmailStatusCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              lastGmailApiCall: 0,
              gmailApiCallCount: 0
            });
            
            return result;
          }
          
          const userData = userDoc.data();
          
          if (!userData?.gmailTokens?.access_token) {
            const result = { 
              userId,
              success: true,
              connected: false,
              email: null,
              lastSync: null,
              syncStatus: 'not_connected',
              message: 'Gmail not connected'
            };
            
            gmailStatusCache.set(cacheKey, { 
              data: result, 
              timestamp: now,
              lastAccess: now,
              accessCount: 1,
              lastGmailApiCall: 0,
              gmailApiCallCount: 0
            });
            
            return result;
          }
          
          // If testing connection or forced, make actual Gmail API call
          if (testConnection || force) {
            const gmailTest = await testGmailAccess(userData);
            
            if (gmailTest.connected) {
              const result = { 
                userId,
                success: true,
                connected: true,
                email: gmailTest.email || userData.gmailTokens.email || userData.email,
                lastSync: userData.lastGmailSync || null,
                syncStatus: 'connected',
                message: 'Gmail connected and accessible'
              };
              
              gmailStatusCache.set(cacheKey, { 
                data: result, 
                timestamp: now,
                lastAccess: now,
                accessCount: 1,
                lastGmailApiCall: now,
                gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1
              });
              
              return result;
              
            } else {
              const result = { 
                userId,
                success: false,
                connected: false,
                email: userData.gmailTokens.email || userData.email,
                lastSync: userData.lastGmailSync || null,
                syncStatus: 'connection_error',
                message: gmailTest.error || 'Gmail connection failed'
              };
              
              gmailStatusCache.set(cacheKey, { 
                data: result, 
                timestamp: now,
                lastAccess: now,
                accessCount: 1,
                lastGmailApiCall: now,
                gmailApiCallCount: (cached?.gmailApiCallCount || 0) + 1
              });
              
              return result;
            }
          }
          
          // For regular status checks, return cached connection status
          const result = { 
            userId,
            success: true,
            connected: true,
            email: userData.gmailTokens.email || userData.email,
            lastSync: userData.lastGmailSync || null,
            syncStatus: 'connected',
            message: 'Gmail connected (cached status)'
          };
          
          gmailStatusCache.set(cacheKey, { 
            data: result, 
            timestamp: now,
            lastAccess: now,
            accessCount: 1,
            lastGmailApiCall: cached?.lastGmailApiCall || 0,
            gmailApiCallCount: cached?.gmailApiCallCount || 0
          });
          
          return result;
          
        } catch (error: any) {
          console.error(`Error processing Gmail status for user ${userRequest.userId}:`, error);
          
          return {
            userId: userRequest.userId || 'unknown',
            success: false,
            connected: false,
            email: null,
            lastSync: null,
            syncStatus: 'error',
            message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to respect API limits
      if (i + concurrencyLimit < userRequests.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log('✅ Batch Gmail status completed', {
      totalUsers: userRequests.length,
      successCount,
      failureCount
    });
    
    return {
      success: true,
      message: `Batch Gmail status completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: {
        total: userRequests.length,
        successful: successCount,
        failed: failureCount
      }
    };
    
  } catch (error) {
    console.error('Error in batchGetGmailStatusOptimized:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to batch get Gmail status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Set up periodic cache cleanup
setInterval(cleanupCache, GMAIL_STATUS_CONFIG.CACHE_CLEANUP_INTERVAL_MS);
