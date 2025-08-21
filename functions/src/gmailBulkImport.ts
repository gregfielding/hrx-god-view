import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import { getFunctions as getAdminFunctions } from 'firebase-admin/functions';
// Cloud Tasks will be handled via HTTP endpoints

const db = getFirestore();
const auth = getAuth();

// Google OAuth configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

// Configuration
const GMAIL_IMPORT_CONFIG = {
  DAYS_BACK: 90,
  MAX_EMAILS_PER_USER: 5000, // Increased limit per user per request
  BATCH_SIZE: 100, // Larger batch to reduce list overhead
  RETRY_ATTEMPTS: 3,
  TASK_TIMEOUT_SECONDS: 540, // 9 minutes
  RATE_LIMIT_DELAY_MS: 50, // Faster per-message pacing; adjust if rate limits hit
  MAX_PROCESSING_TIME_MS: 480000, // 8 minutes max processing time
};

interface GmailImportRequest {
  userIds?: string[];
  emailAddresses?: string[];
  tenantId: string;
  daysBack?: number;
  requestId: string;
}

interface GmailImportTask {
  userId: string;
  email: string;
  tenantId: string;
  daysBack: number;
  requestId: string;
  taskIndex: number;
}

interface ImportProgress {
  requestId: string;
  tenantId: string;
  totalUsers: number;
  completedUsers: number;
  failedUsers: string[];
  inProgressUsers: string[];
  startTime: Date;
  lastUpdate: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  results: {
    [userId: string]: {
      emailsImported: number;
      contactsFound: number;
      errors: string[];
      completedAt: Date;
    };
  };
}

// Master function to queue Gmail imports
export const queueGmailBulkImport = onCall({
  timeoutSeconds: 540, // Increased timeout to 9 minutes
  memory: '512MiB', // Increased memory
  maxInstances: 2,
  cors: true,
}, async (request) => {
  try {
    const { userIds, emailAddresses, tenantId, daysBack = GMAIL_IMPORT_CONFIG.DAYS_BACK } = request.data as GmailImportRequest;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    
    if (!userIds && !emailAddresses) {
      throw new Error('Either userIds or emailAddresses must be provided');
    }

    // Generate unique request ID
    const requestId = `gmail_import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Get user details
    const usersToProcess: Array<{ userId: string; email: string }> = [];
    
    if (userIds) {
      for (const userId of userIds) {
        try {
          const userRecord = await auth.getUser(userId);
          if (userRecord.email) {
            usersToProcess.push({ userId, email: userRecord.email });
          }
        } catch (error) {
          console.error(`Failed to get user ${userId}:`, error);
        }
      }
    }
    
    if (emailAddresses) {
      for (const email of emailAddresses) {
        try {
          const userRecord = await auth.getUserByEmail(email);
          if (userRecord.uid) {
            usersToProcess.push({ userId: userRecord.uid, email });
          }
        } catch (error) {
          console.error(`Failed to get user by email ${email}:`, error);
        }
      }
    }

    if (usersToProcess.length === 0) {
      throw new Error('No valid users found to process');
    }

    // Initialize progress tracking
    const progress: ImportProgress = {
      requestId,
      tenantId,
      totalUsers: usersToProcess.length,
      completedUsers: 0,
      failedUsers: [],
      inProgressUsers: [],
      startTime: new Date(),
      lastUpdate: new Date(),
      status: 'pending',
      results: {},
    };

    // Save progress to Firestore
    await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).set(progress);

    // Mark status to in_progress immediately
    await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).update({
      status: 'in_progress',
      lastUpdate: new Date(),
    });

    // Enqueue background tasks per user using Functions Task Queues to avoid timeouts
    const taskQueue = getAdminFunctions().taskQueue('processGmailImportWorker');
    for (let i = 0; i < usersToProcess.length; i++) {
      const user = usersToProcess[i];
      try {
        await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).update({
          inProgressUsers: FieldValue.arrayUnion(user.userId),
          lastUpdate: new Date(),
        });
      } catch {}
      await taskQueue.enqueue({
        userId: user.userId,
        email: user.email,
        tenantId,
        daysBack,
        requestId,
        taskIndex: i,
        pageToken: null,
        emailsImportedSoFar: 0,
      });
    }

    return {
      success: true,
      requestId,
      totalUsers: usersToProcess.length,
      message: `Queued Gmail import for ${usersToProcess.length} users`,
      headers: {
        'Access-Control-Allow-Origin': 'http://localhost:3000',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };

  } catch (error) {
    console.error('Error in queueGmailBulkImport:', error);
    throw new Error(`Failed to queue Gmail import: ${error.message}`);
  }
});

// Background task worker (resumable) to process one user's emails without timeouts
export const processGmailImportWorker = onTaskDispatched({
  retryConfig: { maxAttempts: 5 },
  rateLimits: { maxConcurrentDispatches: 5 }
}, async (taskRequest) => {
  const task = taskRequest.data as GmailImportTask & { pageToken?: string; emailsImportedSoFar?: number };
  const { userId, email, tenantId, daysBack, requestId } = task;

  console.log(`Starting Gmail import for user ${email} (${userId})`);

  try {
    // Update progress - mark as in progress
    const progressRef = db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId);
    await progressRef.update({
      inProgressUsers: FieldValue.arrayUnion(userId),
      lastUpdate: new Date(),
    });

    // Get user's Gmail credentials
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User document not found');
    }

    const userData = userDoc.data();
    if (!userData?.gmailTokens) {
      throw new Error('Gmail credentials not found for user');
    }

    // Initialize Gmail API client with proper OAuth2 configuration
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
    oauth2Client.setCredentials(userData.gmailTokens);

    // Add token refresh error handler
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        // Update the user's tokens in Firestore
        try {
          await db.collection('users').doc(userId).update({
            gmailTokens: {
              ...userData.gmailTokens,
              refresh_token: tokens.refresh_token,
              access_token: tokens.access_token,
              expiry_date: tokens.expiry_date
            }
          });
          console.log(`Updated tokens for user ${email}`);
        } catch (updateError) {
          console.error(`Failed to update tokens for user ${email}:`, updateError);
        }
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test Gmail API access before starting import
    try {
      console.log(`Testing Gmail API access for user ${email}...`);
      await gmail.users.getProfile({ userId: 'me' });
      console.log(`Gmail API access confirmed for user ${email}`);
    } catch (authError) {
      console.error(`Gmail API access test failed for user ${email}:`, authError);
      
      if (authError.message?.includes('invalid_grant') || authError.response?.data?.error === 'invalid_grant') {
        const errorMessage = 'Gmail access token has expired. User needs to re-authenticate with Gmail.';
        
        // Mark user as needing re-authentication
        try {
          await db.collection('users').doc(userId).update({
            gmailTokens: null, // Clear expired tokens
            gmailAuthNeeded: true, // Flag for re-authentication
            gmailAuthError: errorMessage
          });
          console.log(`Marked user ${email} as needing Gmail re-authentication`);
        } catch (updateError) {
          console.error(`Failed to update user auth status for ${email}:`, updateError);
        }
        
        throw new Error(errorMessage);
      }
      
      throw authError;
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Gmail search prefers epoch seconds; exclude chats to avoid non-email results
    const afterEpoch = Math.floor(startDate.getTime() / 1000);
    const beforeEpoch = Math.floor(endDate.getTime() / 1000);
    const query = `after:${afterEpoch} before:${beforeEpoch} -in:chats`;
    console.log(`Searching Gmail for user ${email} with query: "${query}"`);
    console.log(`Date range: ${startDate.toISOString()} (${afterEpoch}) to ${endDate.toISOString()} (${beforeEpoch})`);
    
    let emailsImported = task.emailsImportedSoFar || 0;
    let contactsFound = 0;
    let errors: string[] = [];
    let pageToken: string | undefined = task.pageToken as any;
    const startTime = Date.now();

    do {
      // Check if we're approaching the timeout
      if (Date.now() - startTime > GMAIL_IMPORT_CONFIG.MAX_PROCESSING_TIME_MS) {
        console.log(`Processing timeout reached for user ${email}, stopping at ${emailsImported} emails`);
        // Enqueue continuation with the next page token (if any)
        if (pageToken) {
          const taskQueue = getAdminFunctions().taskQueue('processGmailImportWorker');
          await taskQueue.enqueue({ ...task, pageToken, emailsImportedSoFar: emailsImported });
        }
        return; // End this dispatch
      }

      try {
        // List messages
        const messagesResponse = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: GMAIL_IMPORT_CONFIG.BATCH_SIZE,
          pageToken,
        });

        const messages = messagesResponse.data.messages || [];
        pageToken = messagesResponse.data.nextPageToken;
        
        console.log(`Found ${messages.length} messages in batch for user ${email}`);
        if (messages.length === 0) {
          console.log(`No more messages found for user ${email}, stopping import`);
          break;
        }

        // Process messages in batches
        for (const message of messages) {
          // Check timeout before processing each message
          if (Date.now() - startTime > GMAIL_IMPORT_CONFIG.MAX_PROCESSING_TIME_MS) {
            console.log(`Processing timeout reached during message processing for user ${email}`);
            // Enqueue continuation since we hit time budget
            const taskQueue = getAdminFunctions().taskQueue('processGmailImportWorker');
            await taskQueue.enqueue({ ...task, pageToken, emailsImportedSoFar: emailsImported });
            return;
          }

          try {
            const result = await processEmailMessage(gmail, message.id!, tenantId, userId, email);
            emailsImported++;
            contactsFound += result.contactsFound;
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, GMAIL_IMPORT_CONFIG.RATE_LIMIT_DELAY_MS));
          } catch (error) {
            console.error(`Error processing message ${message.id}:`, error);
            errors.push(`Message ${message.id}: ${error.message}`);
          }
        }

        // Update progress more frequently
        if (emailsImported % 50 === 0) {
          await updateUserProgress(progressRef, userId, emailsImported, contactsFound, errors);
        }

      } catch (error) {
        console.error('Error fetching messages:', error);
        
        // Handle specific OAuth2 errors
        if (error.message?.includes('invalid_grant') || error.response?.data?.error === 'invalid_grant') {
          const errorMessage = 'Gmail access token has expired. User needs to re-authenticate with Gmail.';
          console.error(`OAuth2 error for user ${email}:`, errorMessage);
          errors.push(errorMessage);
          
          // Mark user as needing re-authentication
          try {
            await db.collection('users').doc(userId).update({
              gmailTokens: null, // Clear expired tokens
              gmailAuthNeeded: true, // Flag for re-authentication
              gmailAuthError: errorMessage
            });
            console.log(`Marked user ${email} as needing Gmail re-authentication`);
          } catch (updateError) {
            console.error(`Failed to update user auth status for ${email}:`, updateError);
          }
          
          break; // Stop processing for this user
        }
        
        errors.push(`Message list error: ${error.message}`);
        // On error, stop and do not chain more to avoid loops
        break;
      }

    } while (pageToken && emailsImported < GMAIL_IMPORT_CONFIG.MAX_EMAILS_PER_USER);

    // Final progress update
    await updateUserProgress(progressRef, userId, emailsImported, contactsFound, errors, true);

    console.log(`Completed Gmail import for user ${email}: ${emailsImported} emails, ${contactsFound} contacts`);

  } catch (error) {
    console.error(`Error in processGmailImport for user ${email}:`, error);
    
    // Update progress with error
    const progressRef = db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId);
    await progressRef.update({
      failedUsers: FieldValue.arrayUnion(userId),
      inProgressUsers: FieldValue.arrayRemove(userId),
      [`results.${userId}`]: {
        emailsImported: 0,
        contactsFound: 0,
        errors: [error.message],
        completedAt: new Date(),
      },
      lastUpdate: new Date(),
    });

    throw error;
  }
});

// Helper function to process individual email message
async function processEmailMessage(
  gmail: any,
  messageId: string,
  tenantId: string,
  userId: string,
  userEmail: string
) {
  const message = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['From', 'To', 'Subject', 'Date'],
  });

  const headers = message.data.payload?.headers || [];
  const from = headers.find((h: any) => h.name === 'From')?.value || '';
  const to = headers.find((h: any) => h.name === 'To')?.value || '';
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
  const date = headers.find((h: any) => h.name === 'Date')?.value || '';

  // Extract email addresses
  const emailAddresses = extractEmailAddresses(from + ' ' + to);
  console.log(`Processing email ${messageId}: Found ${emailAddresses.length} email addresses:`, emailAddresses);
  
  // Find matching contacts (only existing contacts)
  let contactsFound = 0;
  for (const emailAddress of emailAddresses) {
    // Skip if it's the user's own email address
    if (emailAddress.toLowerCase() === userId.toLowerCase()) {
      console.log(`Skipping user's own email address: ${emailAddress}`);
      continue;
    }

    const contactQuery = await db.collection('tenants').doc(tenantId).collection('crm_contacts')
      .where('email', '==', emailAddress)
      .limit(1)
      .get();

    if (!contactQuery.empty) {
      // Contact exists - create email log entry
      const contactId = contactQuery.docs[0].id;
      contactsFound++;
      console.log(`Found existing contact for ${emailAddress}: ${contactId}`);
      
      try {
        const messageDate = new Date(date);
        const direction = from.toLowerCase().includes(userEmail.toLowerCase()) ? 'sent' : 'received';
        await db.collection('tenants').doc(tenantId).collection('email_logs').add({
          messageId,
          gmailMessageId: messageId,
          from,
          to,
          subject,
          date: messageDate,
          timestamp: messageDate,
          contactId,
          matchingContacts: [contactId],
          userId,
          salespersonId: userId,
          direction,
          importedAt: new Date(),
          source: 'gmail_bulk_import',
          emailAddress,
        });
        console.log(`Created email log entry for ${emailAddress}`);
      } catch (logError) {
        console.error(`Failed to create email log entry for ${emailAddress}:`, logError);
      }
    } else {
      console.log(`No existing contact found for ${emailAddress} - skipping`);
    }
  }

  return { contactsFound };
}

// Helper function to extract email addresses from text
function extractEmailAddresses(text: string): string[] {
  const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
  const matches = text.match(emailRegex) || [];
  return [...new Set(matches)]; // Remove duplicates
}

// Helper function to update user progress
async function updateUserProgress(
  progressRef: any, 
  userId: string, 
  emailsImported: number, 
  contactsFound: number, 
  errors: string[], 
  completed: boolean = false
) {
  const updateData: any = {
    lastUpdate: new Date(),
    [`results.${userId}`]: {
      emailsImported,
      contactsFound,
      errors,
      completedAt: completed ? new Date() : null,
    },
  };

  if (completed) {
    updateData.completedUsers = FieldValue.increment(1);
    updateData.inProgressUsers = FieldValue.arrayRemove(userId);
    
    // Check if all users are completed
    const progressDoc = await progressRef.get();
    const progress = progressDoc.data();
    if (progress.completedUsers + 1 >= progress.totalUsers) {
      updateData.status = 'completed';
    }
  }

  await progressRef.update(updateData);
}

// Function to get import progress
export const getGmailImportProgress = onCall({
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 2,
  cors: true,
}, async (request) => {
  const { requestId, tenantId } = request.data;
  
  if (!requestId || !tenantId) {
    throw new Error('requestId and tenantId are required');
  }

  const progressDoc = await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).get();
  
  if (!progressDoc.exists) {
    throw new Error('Import request not found');
  }

  return progressDoc.data();
});

// HTTP version with explicit CORS headers for localhost development
export const getGmailImportProgressHttp = onRequest({
  cors: true,
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 2,
}, async (req, res) => {
  const requestOrigin = (req.headers.origin as string) || '';
  const allowedOrigins = new Set(['http://localhost:3000', 'https://hrxone.com']);
  const corsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : 'http://localhost:3000';

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Vary', 'Origin');
    res.status(204).send('');
    return;
  }

  try {
    const { requestId, tenantId } = req.body || req.query;
    
    if (!requestId || !tenantId) {
      res.status(400).json({ error: 'requestId and tenantId are required' });
      return;
    }

    const progressDoc = await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).get();
    
    if (!progressDoc.exists) {
      res.status(404).json({ error: 'Import request not found' });
      return;
    }

    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');
    res.json(progressDoc.data());
  } catch (error) {
    console.error('Error in getGmailImportProgressHttp:', error);
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Vary', 'Origin');
    res.status(500).json({ error: error.message });
  }
});

// HTTP wrapper for queueing Gmail imports to support localhost development without callable CORS issues
export const queueGmailBulkImportHttp = onRequest({
  cors: true,
  timeoutSeconds: 540,
  memory: '512MiB',
  maxInstances: 2,
}, async (req, res) => {
  const requestOrigin = (req.headers.origin as string) || '';
  const allowedOrigins = new Set(['http://localhost:3000', 'https://hrxone.com']);
  const corsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : 'http://localhost:3000';

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Max-Age', '3600');
    res.set('Vary', 'Origin');
    res.status(204).send('');
    return;
  }

  try {
    const { userIds, emailAddresses, tenantId, daysBack = GMAIL_IMPORT_CONFIG.DAYS_BACK } = (req.body || {}) as Partial<GmailImportRequest>;

    if (!tenantId) {
      res.status(400).json({ success: false, message: 'tenantId is required' });
      return;
    }

    if (!userIds && !emailAddresses) {
      res.status(400).json({ success: false, message: 'Either userIds or emailAddresses must be provided' });
      return;
    }

    const requestId = `gmail_import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const usersToProcess: Array<{ userId: string; email: string }> = [];

    if (userIds) {
      for (const userId of userIds) {
        try {
          const userRecord = await auth.getUser(userId);
          if (userRecord.email) {
            usersToProcess.push({ userId, email: userRecord.email });
          }
        } catch (error) {
          console.error(`Failed to get user ${userId}:`, error);
        }
      }
    }

    if (emailAddresses) {
      for (const email of emailAddresses) {
        try {
          const userRecord = await auth.getUserByEmail(email);
          if (userRecord.uid) {
            usersToProcess.push({ userId: userRecord.uid, email });
          }
        } catch (error) {
          console.error(`Failed to get user by email ${email}:`, error);
        }
      }
    }

    if (usersToProcess.length === 0) {
      res.status(400).json({ success: false, message: 'No valid users found to process' });
      return;
    }

    // Initialize progress tracking
    const progress: ImportProgress = {
      requestId,
      tenantId,
      totalUsers: usersToProcess.length,
      completedUsers: 0,
      failedUsers: [],
      inProgressUsers: [],
      startTime: new Date(),
      lastUpdate: new Date(),
      status: 'pending',
      results: {},
    };

    // Save progress to Firestore
    await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).set(progress);

    // Update progress status to in_progress immediately
    await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).update({
      status: 'in_progress',
      lastUpdate: new Date(),
    });

    const taskQueue = getAdminFunctions().taskQueue('processGmailImportWorker');
    for (let i = 0; i < usersToProcess.length; i++) {
      const user = usersToProcess[i];
      try {
        await db.collection('tenants').doc(tenantId).collection('gmail_imports').doc(requestId).update({
          inProgressUsers: FieldValue.arrayUnion(user.userId),
          lastUpdate: new Date(),
        });
      } catch {}
      await taskQueue.enqueue({
        userId: user.userId,
        email: user.email,
        tenantId,
        daysBack,
        requestId,
        taskIndex: i,
        pageToken: null,
        emailsImportedSoFar: 0,
      });
    }

    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');
    res.json({
      success: true,
      requestId,
      totalUsers: usersToProcess.length,
      message: `Queued Gmail import for ${usersToProcess.length} users`,
    });
  } catch (error: any) {
    console.error('Error in queueGmailBulkImportHttp:', error);
    res.set('Access-Control-Allow-Origin', corsOrigin);
    res.set('Vary', 'Origin');
    res.status(500).json({ success: false, message: error.message || 'Internal error' });
  }
});
