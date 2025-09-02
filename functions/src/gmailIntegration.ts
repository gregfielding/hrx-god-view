import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';


const db = getFirestore();

// Gmail API configuration
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify'
];

import { defineString } from 'firebase-functions/params';

const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

const oauth2Client = new google.auth.OAuth2(
  clientId.value(),
  clientSecret.value(),
  redirectUri.value()
);

/**
 * Get Gmail OAuth URL for user authentication
 */
export const getGmailAuthUrl = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    const state = JSON.stringify({ userId, tenantId });
    // Include both Gmail and Calendar scopes for unified OAuth
    const unifiedScopes = [
      ...GMAIL_SCOPES,
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.settings.readonly'
    ];
    
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: unifiedScopes,
      state,
      prompt: 'consent'
    });

    return { authUrl };
  } catch (error) {
    console.error('Error generating Gmail auth URL:', error);
    throw new Error(`Failed to generate auth URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Handle Gmail OAuth callback and store tokens
 */
export const handleGmailCallback = onCall({
  cors: true
}, async (request) => {
  try {
    const { code, state } = request.data;

    if (!code || !state) {
      throw new Error('Missing required fields: code, state');
    }

    const { userId } = JSON.parse(state);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    // Get user info from Gmail API to get email address
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;
    
    // Check if Calendar scopes are included
    const hasCalendarScope = tokens.scope?.includes('https://www.googleapis.com/auth/calendar');
    
    // Prepare update object
    const updateData: any = {
      gmailTokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
        email: email
      },
      gmailConnected: true,
      gmailConnectedAt: new Date()
    };
    
    // If Calendar scopes are included, also store Calendar tokens
    if (hasCalendarScope) {
      updateData.calendarTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
        email: email
      };
      updateData.calendarConnected = true;
      updateData.calendarConnectedAt = new Date();
    }
    
    // Store tokens securely
    await db.collection('users').doc(userId).update(updateData);

    const message = hasCalendarScope 
      ? 'Google services (Gmail and Calendar) connected successfully'
      : 'Gmail connected successfully';
    
    return { success: true, message };
  } catch (error) {
    console.error('Error handling Gmail callback:', error);
    throw new Error(`Failed to connect Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * HTTP OAuth callback to support Google redirect_uri
 * Stores tokens on the `users/{userId}` document and renders a success page
 */
export const gmailOAuthCallback = onRequest(async (req, res) => {
  try {
    const code = (req.query.code as string) || '';
    const state = (req.query.state as string) || '';

    if (!code || !state) {
      res.status(400).send('Missing required fields: code, state');
      return;
    }

    const { userId } = JSON.parse(state);

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Get user info to capture email
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress || '';

    const hasCalendarScope = tokens.scope?.includes('https://www.googleapis.com/auth/calendar');

    const updateData: any = {
      gmailTokens: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
        email: email
      },
      gmailConnected: true,
      gmailConnectedAt: new Date()
    };

    if (hasCalendarScope) {
      updateData.calendarTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        token_type: tokens.token_type,
        expiry_date: tokens.expiry_date,
        email: email
      };
      updateData.calendarConnected = true;
      updateData.calendarConnectedAt = new Date();
    }

    await db.collection('users').doc(userId).set(updateData, { merge: true });

    // Simple success HTML
    const message = hasCalendarScope
      ? 'Google services (Gmail and Calendar) connected successfully'
      : 'Gmail connected successfully';

    res.status(200).send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Gmail Integration Successful</title></head>
  <body style="font-family: Arial, sans-serif; padding: 24px;">
    <h1>Gmail Integration Successful!</h1>
    <p>Your Gmail account (${email}) has been successfully connected.</p>
    <p>${message}</p>
    <p>You can close this window and return to the application.</p>
    <script>
      // Try to notify opener to refresh status
      if (window.opener && typeof window.opener.postMessage === 'function') {
        window.opener.postMessage({ type: 'google-auth-success' }, '*');
      }
    </script>
  </body>
</html>`);
  } catch (error) {
    console.error('Error in gmailOAuthCallback:', error);
    res.status(500).send('Failed to connect Gmail. Please close this window and try again.');
  }
});

/**
 * Sync emails from Gmail for a user
 */
export const syncGmailEmails = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId, maxResults = 50 } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      throw new Error('Gmail not connected. Please authenticate first.');
    }

    // Set up Gmail API client
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get recent messages
    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'is:email' // Only emails, not chats
    });

    const messages = messagesResponse.data.messages || [];
    let syncedCount = 0;
    const newEmails = [];

    // Process each message
    for (const message of messages) {
      try {
        // Check if email already exists
        const existingEmail = await db.collection('tenants').doc(tenantId)
          .collection('email_logs')
          .where('messageId', '==', message.id)
          .limit(1)
          .get();

        if (!existingEmail.empty) {
          continue; // Skip if already synced
        }

        // Get full message details
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        });

        const messageData = messageResponse.data;
        const headers = messageData.payload?.headers || [];
        
        // Extract email data
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const cc = headers.find(h => h.name === 'Cc')?.value || '';
        const bcc = headers.find(h => h.name === 'Bcc')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Extract body
        let bodySnippet = messageData.snippet || '';
        let bodyHtml = '';

        if (messageData.payload?.body?.data) {
          bodySnippet = Buffer.from(messageData.payload.body.data, 'base64').toString();
        } else if (messageData.payload?.parts) {
          for (const part of messageData.payload.parts) {
            if (part.mimeType === 'text/html' && part.body?.data) {
              bodyHtml = Buffer.from(part.body.data, 'base64').toString();
            } else if (part.mimeType === 'text/plain' && part.body?.data) {
              bodySnippet = Buffer.from(part.body.data, 'base64').toString();
            }
          }
        }

        // Determine direction
        const userEmail = userData?.email || '';
        const direction = from.includes(userEmail) ? 'outbound' : 'inbound';

        // Find associated contacts
        const allEmails = [from, to, cc, bcc].flat().filter(Boolean);
        const contactMap = new Map();

        for (const email of allEmails) {
          const contactQuery = await db.collection('tenants').doc(tenantId)
            .collection('crm_contacts')
            .where('email', '==', email)
            .limit(1)
            .get();

          if (!contactQuery.empty) {
            const contact = contactQuery.docs[0];
            contactMap.set(email, {
              id: contact.id,
              ...contact.data()
            });
          }
        }

        // Find most relevant deal for contacts
        let dealId = null;
        for (const contact of contactMap.values()) {
          const dealQuery = await db.collection('tenants').doc(tenantId)
            .collection('crm_deals')
            .where('associations.contacts', 'array-contains', contact.id)
            .orderBy('updatedAt', 'desc')
            .limit(1)
            .get();

          if (!dealQuery.empty) {
            dealId = dealQuery.docs[0].id;
            break;
          }
        }

        // Create email log
        const emailLog = {
          messageId: message.id!,
          threadId: messageData.threadId!,
          subject,
          from,
          to: to.split(',').map(e => e.trim()).filter(Boolean),
          cc: cc.split(',').map(e => e.trim()).filter(Boolean),
          bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
          timestamp: new Date(date),
          bodySnippet: bodySnippet.substring(0, 250),
          bodyHtml,
          direction,
          contactId: contactMap.size > 0 ? Array.from(contactMap.values())[0].id : null,
          companyId: contactMap.size > 0 ? Array.from(contactMap.values())[0].companyId : null,
          dealId,
          userId,
          isDraft: messageData.labelIds?.includes('DRAFT') || false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Save to Firestore
        await db.collection('tenants').doc(tenantId)
          .collection('email_logs')
          .add(emailLog);

        newEmails.push(emailLog);
        syncedCount++;

      } catch (messageError) {
        console.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    }

    return {
      success: true,
      syncedCount,
      newEmails: newEmails.length
    };

  } catch (error) {
    console.error('Error syncing Gmail emails:', error);
    throw new Error(`Failed to sync emails: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Disconnect Gmail for a user
 */
export const disconnectGmail = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    // Remove Gmail tokens
    await db.collection('users').doc(userId).update({
      gmailTokens: null,
      gmailConnected: false,
      gmailDisconnectedAt: new Date()
    });

    return { success: true, message: 'Gmail disconnected successfully' };
  } catch (error) {
    console.error('Error disconnecting Gmail:', error);
    throw new Error(`Failed to disconnect Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Add caching for Gmail status to reduce database calls
const gmailStatusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds cache

/**
 * Get Gmail connection status for a user
 * Optimized with caching to reduce database calls
 */
export const getGmailStatus = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    // Check cache first
    const cached = gmailStatusCache.get(userId);
    const now = Date.now();
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('Gmail status served from cache for user:', userId);
      return cached.data;
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    console.log('Gmail status check - userData:', {
      gmailConnected: userData?.gmailConnected,
      hasGmailTokens: !!userData?.gmailTokens?.access_token,
      email: userData?.gmailTokens?.email || userData?.email,
      fullUserData: userData // Log the entire user data to see what's actually stored
    });
    
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
    gmailStatusCache.set(userId, { data: result, timestamp: now });

    console.log('Gmail status result:', result);

    return result;
  } catch (error) {
    console.error('Error getting Gmail status:', error);
    throw new Error(`Failed to get Gmail status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// Clear cache when user data changes (called from other functions)
export const clearGmailStatusCache = (userId: string) => {
  gmailStatusCache.delete(userId);
};

/**
 * Monitor Gmail for new sent emails and log them as contact activities
 * This function should be called periodically (e.g., every 15 minutes) to check for new emails
 */
// monitorGmailForContactEmails has been removed to avoid duplicate ingestion; scheduledGmailMonitoring
// with monitorGmailForContactEmailsInternal is the single ingestion path.

/**
 * Test Gmail token validity and force re-authentication if needed
 */
export const testGmailTokenValidity = onCall({
  cors: true
}, async (request) => {
  if (!request.auth) {
    throw new Error('User must be authenticated');
  }

  const { userId, tenantId } = request.data;
  if (!userId || !tenantId) {
    throw new Error('User ID and Tenant ID are required');
  }

  console.log('🔍 testGmailTokenValidity called with:', {
    userId,
    tenantId,
    authUid: request.auth.uid
  });

  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log('❌ User document not found');
      throw new Error('User not found');
    }

    const userData = userDoc.data() as any;
    const tokens = userData?.gmailTokens;

    console.log('🔍 Gmail tokens check:', {
      hasUserData: !!userData,
      hasGmailTokens: !!tokens,
      hasAccessToken: !!tokens?.access_token,
      hasRefreshToken: !!tokens?.refresh_token,
      email: tokens?.email
    });

    if (!tokens?.access_token) {
      console.log('❌ No Gmail tokens found');
      return { valid: false, reason: 'No Gmail tokens found', needsReauth: true, source: 'user' };
    }

    oauth2Client.setCredentials({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    try {
      console.log('🔍 Testing Gmail token with gmail.users.getProfile...');
      const testResponse = await gmail.users.getProfile({ userId: 'me' });
      console.log('✅ Gmail token validation successful:', {
        email: testResponse.data.emailAddress,
        messagesTotal: testResponse.data.messagesTotal,
        threadsTotal: testResponse.data.threadsTotal
      });
      return { valid: true, reason: 'Gmail token is valid', needsReauth: false, source: 'user' };
    } catch (error: any) {
      console.error('❌ Gmail token validation failed:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status
      });
      
      if (error?.message?.includes('invalid_grant') || error?.message?.includes('unauthorized')) {
        console.log('🔄 Clearing invalid Gmail tokens...');
        await db.collection('users').doc(userId).set({
          gmailTokens: null,
          gmailConnected: false,
          gmailConnectedAt: null,
          lastGmailSync: null
        }, { merge: true });
        return { valid: false, reason: 'Gmail token is invalid or expired', needsReauth: true, source: 'user' };
      }
      return { valid: false, reason: `Gmail token API error: ${error.message}`, needsReauth: false, source: 'user' };
    }
  } catch (error) {
    console.error('❌ Error testing Gmail token validity:', error);
    throw new Error(`Failed to test Gmail token validity: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Test Gmail connection and email capture
 */
export const testGmailEmailCapture = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId } = request.data;

    if (!userId || !tenantId) {
      throw new Error('Missing required fields: userId, tenantId');
    }

    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      throw new Error('Gmail not connected. Please authenticate first.');
    }

    // Set up Gmail API client
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test Gmail API connection
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress;

    // Get recent sent messages (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const query = `from:${email} after:${Math.floor(sevenDaysAgo.getTime() / 1000)}`;

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 10,
      q: query
    });

    const messages = messagesResponse.data.messages || [];
    const testResults = [];

    // Test processing a few messages
    for (const message of messages.slice(0, 3)) {
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        });

        const messageData = messageResponse.data;
        const headers = messageData.payload?.headers || [];
        
        const to = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Check if any recipients are contacts in CRM (check To, CC, BCC)
        const toEmails = extractEmailAddresses(to);
        const ccEmails = extractEmailAddresses(headers.find(h => h.name === 'Cc')?.value || '');
        const bccEmails = extractEmailAddresses(headers.find(h => h.name === 'Bcc')?.value || '');
        
        const allRecipients = [...toEmails, ...ccEmails, ...bccEmails];
        
        // Debug: Log what we're searching for
        console.log(`🔍 Testing message ${message.id}:`, {
          subject,
          toEmails,
          ccEmails,
          bccEmails,
          allRecipients
        });
        
        const contactQuery = await db.collection('tenants').doc(tenantId)
          .collection('crm_contacts')
          .where('email', 'in', allRecipients)
          .get();

        const contacts = contactQuery.docs.map(doc => ({
          id: doc.id,
          email: doc.data().email,
          name: doc.data().fullName || `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim()
        }));

        // Debug: Log contact matching results
        console.log(`📧 Contact matching for message ${message.id}:`, {
          recipientsSearched: allRecipients,
          contactsFound: contacts.length,
          contactDetails: contacts
        });

        testResults.push({
          messageId: message.id,
          subject,
          date,
          recipients: allRecipients,
          contactsFound: contacts.length,
          contacts: contacts
        });

      } catch (messageError) {
        testResults.push({
          messageId: message.id,
          error: messageError instanceof Error ? messageError.message : 'Unknown error'
        });
      }
    }

    // Debug: Get all contacts in the tenant to help with debugging
    console.log(`🔍 Querying contacts for tenant: ${tenantId}`);
    const allContactsSnapshot = await db.collection('tenants').doc(tenantId)
      .collection('crm_contacts')
      .limit(10)
      .get();
    
    console.log(`📊 Contact query results:`, {
      tenantId,
      collectionPath: `tenants/${tenantId}/crm_contacts`,
      docsFound: allContactsSnapshot.docs.length,
      empty: allContactsSnapshot.empty
    });
    
    const allContacts = allContactsSnapshot.docs.map(doc => ({
      id: doc.id,
      email: doc.data().email,
      name: doc.data().fullName || `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim()
    }));

    console.log(`🔍 All contacts in tenant ${tenantId}:`, allContacts);

    return {
      success: true,
      userEmail: email,
      totalMessagesFound: messages.length,
      testResults,
      allContacts, // Include for debugging
      message: `Gmail connection test completed. Found ${messages.length} sent messages in the last 7 days.`
    };

  } catch (error) {
    console.error('Error testing Gmail email capture:', error);
    throw new Error(`Failed to test Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}); 

/**
 * One-time bulk import of Gmail emails (last 90 days)
 * Use this to import historical emails without duplicates
 */
export const bulkImportGmailEmails = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1',
  timeoutSeconds: 540
}, async (request) => {
  try {
    const { tenantId, daysBack = 30 } = request.data;
    
    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }
    
    console.log(`🔄 Starting bulk Gmail import for ALL users in tenant ${tenantId}, last ${daysBack} days`);
    
    // Get all users in this tenant with Gmail connected
    const usersSnapshot = await db.collection('users')
      .where('gmailConnected', '==', true)
      .get();
    
    if (usersSnapshot.empty) {
      return {
        success: true,
        processedCount: 0,
        activityLogsCreated: 0,
        duplicatesSkipped: 0,
        message: 'No users with Gmail connected found in this tenant',
        headers: {
          'Access-Control-Allow-Origin': 'https://hrxone.com',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      };
    }
    
    console.log(`👥 Found ${usersSnapshot.docs.length} users with Gmail connected`);
    
    // Get all contacts for this tenant to check for matches
    const contactsSnapshot = await db.collection('tenants').doc(tenantId).collection('crm_contacts').get();
    const contacts = contactsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
    
    console.log(`👥 Found ${contacts.length} contacts to match against`);
    
    let totalProcessedCount = 0;
    let totalActivityLogsCreated = 0;
    let totalDuplicatesSkipped = 0;
    const userResults: any[] = [];
    
    // Process each user (limit to first 3 users to avoid timeouts)
    const maxUsers = 3;
    const usersToProcess = usersSnapshot.docs.slice(0, maxUsers);
    
    for (const userDoc of usersToProcess) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        
        // Verify this user belongs to the specified tenant
        const userTenantId = userData.tenantId || userData.defaultTenantId;
        if (userTenantId !== tenantId) {
          console.log(`⚠️ User ${userId} belongs to tenant ${userTenantId}, skipping (requested tenant: ${tenantId})`);
          continue;
        }
        
        if (!userData?.gmailTokens) {
          console.log(`⚠️ User ${userId} has no Gmail tokens, skipping`);
          continue;
        }
        
        console.log(`📧 Processing user ${userId} (${userData.email || 'unknown email'})`);
        
        // Set up Gmail API for this user
        oauth2Client.setCredentials(userData.gmailTokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        
        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        
        console.log(`📅 Importing emails from ${startDate.toISOString()} to ${endDate.toISOString()} for user ${userId}`);
        
        // Query for sent emails in the date range - limit to 100 messages per user to avoid timeouts
        const query = `in:sent after:${Math.floor(startDate.getTime() / 1000)} before:${Math.floor(endDate.getTime() / 1000)}`;
        
        const response = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 100 // Reduced from 500 to avoid timeouts
        });
        
        const messages = response.data.messages || [];
        console.log(`📨 Found ${messages.length} emails for user ${userId}`);
        
        if (messages.length === 0) {
          userResults.push({
            userId,
            userEmail: userData.email,
            processedCount: 0,
            activityLogsCreated: 0,
            duplicatesSkipped: 0,
            message: 'No emails found'
          });
          continue;
        }
        
        let userProcessedCount = 0;
        let userActivityLogsCreated = 0;
        let userDuplicatesSkipped = 0;
    
    // Process each email
    for (const message of messages) {
      try {
        // Get full message details
        const messageDetails = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        });
        
        const emailData = messageDetails.data;
        const headers = emailData.payload?.headers || [];
        
        // Extract email details
        const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        
        // Extract email addresses from To field
        const emailAddresses = extractEmailAddresses(to);
        
        if (emailAddresses.length === 0) {
          console.log(`⚠️ No email addresses found in To field for message ${message.id}`);
          continue;
        }
        
        // Check if this email has already been processed
        const existingEmailLog = await db.collection('tenants').doc(tenantId)
          .collection('email_logs')
          .where('gmailMessageId', '==', message.id)
          .limit(1)
          .get();
        
        if (!existingEmailLog.empty) {
          console.log(`⏭️ Skipping duplicate email ${message.id}`);
          userDuplicatesSkipped++;
          continue;
        }
        
        // Find matching contacts
        const matchingContacts = contacts.filter(contact => 
          contact.email && emailAddresses.includes(contact.email.toLowerCase())
        );
        
        // Create email log entry for ALL emails (not just matching ones)
        const emailLog = {
          gmailMessageId: message.id,
          subject,
          to,
          from,
          date: new Date(date),
          emailAddresses,
          processedAt: new Date(),
          tenantId,
          userId,
          matchingContacts: matchingContacts.map(c => c.id)
        };
        
        await db.collection('tenants').doc(tenantId).collection('email_logs').add(emailLog);
        
        // Only create activity logs for matching contacts
        if (matchingContacts.length > 0) {
          for (const contact of matchingContacts) {
            const activityLog = {
              type: 'email',
              title: `Email: ${subject}`,
              description: `Email sent to ${contact.email}`,
              timestamp: new Date(date),
              salespersonId: userId,
              tenantId,
              contactId: contact.id,
              metadata: {
                direction: 'sent',
                gmailMessageId: message.id,
                subject,
                to: contact.email
              }
            };
            
            await db.collection('tenants').doc(tenantId).collection('activity_logs').add(activityLog);
            userActivityLogsCreated++;
          }
        } else {
          console.log(`📧 Email processed but no matching contacts: ${emailAddresses.join(', ')}`);
        }
        
        userProcessedCount++;
        
        if (userProcessedCount % 10 === 0) {
          console.log(`📊 Progress for user ${userId}: ${userProcessedCount}/${messages.length} emails processed`);
        }
        
      } catch (messageError) {
        console.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    }
    
    console.log(`✅ User ${userId}: ${userProcessedCount} emails processed, ${userActivityLogsCreated} activity logs created, ${userDuplicatesSkipped} duplicates skipped`);
    
    // Add user results
    userResults.push({
      userId,
      userEmail: userData.email,
      processedCount: userProcessedCount,
      activityLogsCreated: userActivityLogsCreated,
      duplicatesSkipped: userDuplicatesSkipped,
      message: 'Success'
    });
    
    // Add to totals
    totalProcessedCount += userProcessedCount;
    totalActivityLogsCreated += userActivityLogsCreated;
    totalDuplicatesSkipped += userDuplicatesSkipped;
    
  } catch (userError) {
    console.error(`❌ Error processing user ${userDoc.id}:`, userError);
    userResults.push({
      userId: userDoc.id,
      userEmail: userDoc.data()?.email || 'unknown',
      processedCount: 0,
      activityLogsCreated: 0,
      duplicatesSkipped: 0,
      message: `Error: ${userError instanceof Error ? userError.message : 'Unknown error'}`
    });
  }
}

console.log(`🎉 Bulk import completed: ${totalProcessedCount} total emails processed, ${totalActivityLogsCreated} total activity logs created, ${totalDuplicatesSkipped} total duplicates skipped`);

return {
  success: true,
  processedCount: totalProcessedCount,
  activityLogsCreated: totalActivityLogsCreated,
  duplicatesSkipped: totalDuplicatesSkipped,
  userResults,
  message: `Bulk import completed: ${totalProcessedCount} emails processed, ${totalActivityLogsCreated} activity logs created, ${totalDuplicatesSkipped} duplicates skipped`,
  headers: {
    'Access-Control-Allow-Origin': 'https://hrxone.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }
};
    
  } catch (error) {
    console.error('❌ Error in bulk Gmail import:', error);
    return {
      success: false,
      message: `Bulk import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      headers: {
        'Access-Control-Allow-Origin': 'https://hrxone.com',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      }
    };
  }
});

/**
 * One-time backfill function to process emails from the last 24 hours
 * This can be called manually to capture any missed emails
 */
export const backfillGmailEmails = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 540 // 9 minutes
}, async (request) => {
  try {
    const { hours = 24 } = request.data as any;
    
    console.log(`🔄 Starting Gmail backfill for last ${hours} hours...`);
    
    // Get all users with Gmail connected
    const usersSnapshot = await db.collection('users')
      .where('gmailConnected', '==', true)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('No users with Gmail connected found');
      return { success: true, message: 'No users with Gmail connected found' };
    }
    
    console.log(`Found ${usersSnapshot.docs.length} users with Gmail connected`);
    
    let totalProcessed = 0;
    let totalActivityLogs = 0;
    const results = [];
    
    // Process each user
    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        
        // Get user's tenant ID
        const tenantId = userData.tenantId || userData.defaultTenantId;
        
        if (!tenantId) {
          console.log(`No tenant ID found for user ${userId}, skipping`);
          continue;
        }
        
        console.log(`Processing user ${userId} for tenant ${tenantId}`);
        
        // Call the monitoring function with deep scan
        try {
          const result = await monitorGmailForContactEmailsInternal(
            userId,
            tenantId,
            500, // Higher limit for backfill
            { deepScanHours: hours }
          );
          
          if (result.success) {
            totalProcessed += result.processedCount || 0;
            totalActivityLogs += result.activityLogsCreated || 0;
            results.push({
              userId,
              tenantId,
              processed: result.processedCount || 0,
              activityLogs: result.activityLogsCreated || 0,
              success: true
            });
            console.log(`✅ User ${userId}: ${result.processedCount} emails processed, ${result.activityLogsCreated} activity logs created`);
          } else {
            results.push({
              userId,
              tenantId,
              error: result.message || 'Unknown error',
              success: false
            });
            console.error(`❌ User ${userId}: ${result.message || 'Unknown error'}`);
          }
        } catch (error) {
          results.push({
            userId,
            tenantId,
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false
          });
          console.error(`❌ Error processing user ${userId}:`, error);
        }
        
      } catch (userError) {
        console.error(`Error processing user ${userDoc.id}:`, userError);
        results.push({
          userId: userDoc.id,
          error: userError instanceof Error ? userError.message : 'Unknown error',
          success: false
        });
      }
    }
    
    console.log(`🎉 Gmail backfill completed: ${totalProcessed} emails processed, ${totalActivityLogs} activity logs created`);
    
    return {
      success: true,
      totalProcessed,
      totalActivityLogs,
      results,
      message: `Backfill completed: ${totalProcessed} emails processed, ${totalActivityLogs} activity logs created`
    };
    
  } catch (error) {
    console.error('❌ Error in Gmail backfill:', error);
    return {
      success: false,
      message: `Failed to backfill Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
});

/**
 * Helper function to extract email addresses from a string
 */
function extractEmailAddresses(text: string): string[] {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailRegex) || [];
  return matches.map(email => email.toLowerCase());
}

/**
 * Internal function for monitoring Gmail (used by scheduled function)
 */
async function monitorGmailForContactEmailsInternal(userId: string, tenantId: string, maxResults: number = 100, opts?: { deepScanHours?: number }) {
  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      throw new Error('Gmail not connected. Please authenticate first.');
    }

    // Set up Gmail API client
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Test token validity before proceeding (same pattern as calendar integration)
    try {
      console.log('🔍 Testing Gmail API access...');
      const testResponse = await gmail.users.getProfile({ userId: 'me' });
      console.log('✅ Gmail API token validation successful:', {
        email: testResponse.data.emailAddress,
        messagesTotal: testResponse.data.messagesTotal,
        threadsTotal: testResponse.data.threadsTotal
      });
    } catch (tokenError) {
      console.error('❌ Gmail token validation failed:', tokenError);
      console.error('❌ Token error details:', {
        message: tokenError.message,
        code: tokenError.code,
        stack: tokenError.stack,
        response: tokenError.response?.data,
        status: tokenError.response?.status
      });
      
      // Handle invalid_grant error specifically (same pattern as calendar integration)
      if (tokenError.message === 'invalid_grant' || 
          (tokenError.message && tokenError.message.includes('invalid_grant'))) {
        console.log('🔄 Clearing invalid Gmail tokens for user:', userId);
        // Clear invalid tokens so future calls don't use them
        await db.collection('users').doc(userId).set({
          gmailTokens: null,
          gmailConnected: false,
          gmailConnectedAt: null,
          lastGmailSync: null
        }, { merge: true });
        throw new Error('Gmail access has expired. Please reconnect your Google account.');
      }
      
      throw new Error('Unable to access Gmail. Please check your connection.');
    }

    // Get the last processed timestamp for this user to avoid duplicates
    const lastProcessedDoc = await db.collection('tenants').doc(tenantId)
      .collection('gmail_processing_state')
      .doc(userId)
      .get();

    let lastProcessedTime: Date;
    // If deepScanHours is provided (e.g., manual backfill), always honor it regardless of saved state
    if (opts?.deepScanHours && opts.deepScanHours > 0) {
      lastProcessedTime = new Date(Date.now() - opts.deepScanHours * 60 * 60 * 1000);
    } else if (lastProcessedDoc.exists) {
      lastProcessedTime = lastProcessedDoc.data()?.lastProcessedTime?.toDate() || new Date(Date.now() - 30 * 60 * 1000);
    } else {
      // If no previous processing record, start from a wider window to ensure completeness
      const deepHours = 1; // default 1 hour first run
      lastProcessedTime = new Date(Date.now() - deepHours * 60 * 60 * 1000);
    }

    const userEmail = (userData?.email || userData?.gmailTokens?.email || '').toLowerCase();
    
    // Guard against a future-stamped state (reset to deep scan window)
    const nowSafe = new Date();
    if (lastProcessedTime > nowSafe) {
      const fallbackHours = opts?.deepScanHours ?? 12;
      lastProcessedTime = new Date(nowSafe.getTime() - fallbackHours * 60 * 60 * 1000);
    }

    // Use the last processed time to avoid duplicates; add small backoff for clock skew
    const afterEpoch = Math.floor((lastProcessedTime.getTime() - 60 * 1000) / 1000); // minus 60s
    // Capture both outbound (from:me) and inbound (to:me -from:me) messages
    const query = `(from:me OR to:me) after:${afterEpoch}`;
    
    console.log(`🔍 Searching for emails (inbound and outbound) with query: "${query}"`);
    console.log(`📧 User email: ${userEmail}`);
    console.log(`⏰ Last processed time: ${lastProcessedTime.toISOString()}`);

    let nextPageToken: string | undefined = undefined;
    let page = 0;
    let processedCount = 0;
    let activityLogsCreated = 0;
    const processedSummaries: Array<{ messageId: string; subject: string; direction: 'outbound' | 'inbound'; emailDate: string; from: string; to: string[]; cc: string[]; bcc: string[]; contactEmails: string[]; contactsFound: number }> = [];
    let latestProcessedTime = lastProcessedTime;

    do {
      page += 1;
      const messagesResponse = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query,
        pageToken: nextPageToken
      });

      const messages = messagesResponse.data.messages || [];
      nextPageToken = messagesResponse.data.nextPageToken || undefined;
      console.log(`📨 Page ${page}: found ${messages.length} emails since last processing`);
      
      if (messages.length === 0) {
        break;
      }

      // Process each sent message
      for (const message of messages) {
      try {
        // Get full message details first to get the actual email date
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!
        });

        const messageData = messageResponse.data;
        const headers = messageData.payload?.headers || [];
        // Prefer internalDate from Gmail (epoch ms), fallback to Date header
        const internalMs = Number(messageData.internalDate || 0);
        const headerDate = headers.find(h => h.name === 'Date')?.value || '';
        const emailDate = internalMs ? new Date(internalMs) : new Date(headerDate);

        // Skip if this email is older than our last processed time (extra safety check)
        if (emailDate <= lastProcessedTime) {
          console.log(`⏭️ Skipping message ${message.id} - older than last processed time`);
          continue;
        }

        // Check if this email has already been processed (double-check)
        const existingActivity = await db.collection('tenants').doc(tenantId)
          .collection('activity_logs')
          .where('metadata.gmailMessageId', '==', message.id)
          .limit(1)
          .get();

        if (!existingActivity.empty) {
          console.log(`⏭️ Skipping message ${message.id} - already processed`);
          continue;
        }

        // Extract email data
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const cc = headers.find(h => h.name === 'Cc')?.value || '';
        const bcc = headers.find(h => h.name === 'Bcc')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';

        // Extract body snippet
        let bodySnippet = messageData.snippet || '';
        if (messageData.payload?.body?.data) {
          bodySnippet = Buffer.from(messageData.payload.body.data, 'base64').toString();
        } else if (messageData.payload?.parts) {
          for (const part of messageData.payload.parts) {
            if (part.mimeType === 'text/plain' && part.body?.data) {
              bodySnippet = Buffer.from(part.body.data, 'base64').toString();
              break;
            }
          }
        }

        // Determine direction (outbound if from user, inbound otherwise)
        const fromEmail = extractEmailAddresses(from)[0] || '';
        const isOutbound = fromEmail.toLowerCase() === userEmail;

        // Build set of candidate contact emails: recipients, and for inbound also the sender
        const allRecipients = [to, cc, bcc].flat().filter(Boolean);
        const contactEmails = allRecipients.flatMap(email => extractEmailAddresses(email));
        if (!isOutbound && fromEmail) {
          contactEmails.push(fromEmail.toLowerCase());
        }
        
        // Debug: Log email parsing
        console.log(`🔍 Email parsing for message ${message.id}:`, {
          subject,
          from,
          to,
          cc,
          bcc,
          allRecipients,
          contactEmails,
          emailDate: emailDate.toISOString()
        });
        
        // Find contacts in CRM
        // Firestore 'in' supports max 10 values; chunk queries if needed
        const chunked = [] as any[];
        for (let i = 0; i < contactEmails.length; i += 10) {
          const batch = contactEmails.slice(i, i + 10);
          if (batch.length === 0) continue;
          try {
            const snap = await db.collection('tenants').doc(tenantId)
              .collection('crm_contacts')
              .where('email', 'in', batch)
              .get();
            chunked.push(...snap.docs);
          } catch (chunkErr) {
            console.warn('Contact IN query failed for batch', batch, chunkErr);
          }
        }
        // De-duplicate contacts by id
        const uniqueContactDocs = Array.from(new Map(chunked.map(d => [d.id, d])).values());

        // Debug: Log contact matching results
        console.log(`📧 Contact matching for message ${message.id}:`, {
          emailsSearched: contactEmails,
          contactsFound: uniqueContactDocs.length,
          contactDetails: uniqueContactDocs.map(doc => ({
            id: doc.id,
            email: doc.data().email,
            name: doc.data().fullName || `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim()
          }))
        });

        if (uniqueContactDocs.length === 0) {
          console.log(`❌ No contacts found for message ${message.id}. Logging email only for traceability.`);
          // Write a lightweight email_log so we can audit unmatched emails
          try {
            await db.collection('tenants').doc(tenantId)
              .collection('email_logs')
              .add({
                messageId: message.id,
                threadId: messageData.threadId,
                subject,
                from,
                to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
                cc: cc.split(',').map((e: string) => e.trim()).filter(Boolean),
                bcc: bcc.split(',').map((e: string) => e.trim()).filter(Boolean),
                timestamp: emailDate,
                bodySnippet: bodySnippet.substring(0, 250),
                direction: isOutbound ? 'outbound' : 'inbound',
                userId,
                contactId: null,
                companyId: null,
                dealId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                note: 'unmatched_contact'
              });
          } catch (logErr) {
            console.warn('Failed to write unmatched email_log for message', message.id, logErr);
          }
          // Record processed summary for logging purposes
          processedSummaries.push({
            messageId: message.id!,
            subject: subject || '',
            direction: isOutbound ? 'outbound' : 'inbound',
            emailDate: emailDate.toISOString(),
            from,
            to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
            cc: cc.split(',').map((e: string) => e.trim()).filter(Boolean),
            bcc: bcc.split(',').map((e: string) => e.trim()).filter(Boolean),
            contactEmails,
            contactsFound: 0
          });
          // Update latest processed time and count this message as processed
          if (emailDate > latestProcessedTime) {
            latestProcessedTime = emailDate;
          }
          processedCount++;
          continue;
        }

        const contacts = uniqueContactDocs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];

        console.log(`✅ Found ${contacts.length} contacts for message ${message.id}, creating activity logs...`);

        // Create activity log for each contact
        for (const contact of contacts) {
          try {
            // Find associated deals for this contact
            let dealId = null;
            try {
              // Simplified query to avoid index requirements
              const dealQuery = await db.collection('tenants').doc(tenantId)
                .collection('crm_deals')
                .where('associations.contacts', 'array-contains', contact.id)
                .limit(1)
                .get();

              if (!dealQuery.empty) {
                dealId = dealQuery.docs[0].id;
              }
            } catch (dealQueryError) {
              console.warn(`Could not query deals for contact ${contact.id}:`, dealQueryError.message);
              // Continue without deal association
            }

            // Create activity log
            const activityLog = {
              tenantId,
              entityType: 'contact',
              entityId: contact.id,
              activityType: 'email',
              title: `Email ${isOutbound ? 'sent' : 'received'}: ${subject}`,
              description: bodySnippet.substring(0, 200) + (bodySnippet.length > 200 ? '...' : ''),
              timestamp: emailDate,
              userId,
              userName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
              metadata: {
                emailSubject: subject,
                emailFrom: from,
                emailTo: to,
                emailCc: cc,
                emailBcc: bcc,
                direction: isOutbound ? 'outbound' : 'inbound',
                gmailMessageId: message.id,
                gmailThreadId: messageData.threadId,
                bodySnippet: bodySnippet.substring(0, 500),
                contactEmail: contact.email,
                contactName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
              },
              associations: {
                contacts: [contact.id],
                deals: dealId ? [dealId] : [],
                companies: contact.companyId ? [contact.companyId] : []
              },
              createdAt: new Date(),
              updatedAt: new Date()
            };

            // Save activity log
            await db.collection('tenants').doc(tenantId)
              .collection('activity_logs')
              .add(activityLog);

            // Get all associated entities for comprehensive "filter up" functionality
            const associatedEntities = {
              companies: new Set<string>(),
              locations: new Set<string>(),
              deals: new Set<string>()
            };

            // Collect company associations
            if (contact.companyId) {
              associatedEntities.companies.add(contact.companyId);
            }
            if (contact.associations?.companies) {
              contact.associations.companies.forEach((company: any) => {
                const companyId = typeof company === 'string' ? company : company?.id;
                if (companyId) associatedEntities.companies.add(companyId);
              });
            }

            // Collect location associations
            if (contact.locationId) {
              associatedEntities.locations.add(contact.locationId);
            }
            if (contact.associations?.locations) {
              contact.associations.locations.forEach((location: any) => {
                const locationId = typeof location === 'string' ? location : location?.id;
                if (locationId) associatedEntities.locations.add(locationId);
              });
            }

            // Collect deal associations
            if (dealId) {
              associatedEntities.deals.add(dealId);
            }
            if (contact.associations?.deals) {
              contact.associations.deals.forEach((deal: any) => {
                const dealId = typeof deal === 'string' ? deal : deal?.id;
                if (dealId) associatedEntities.deals.add(dealId);
              });
            }

            // Update active salespeople for contact
            try {
              const contactDoc = await db.collection('tenants').doc(tenantId)
                .collection('crm_contacts')
                .doc(contact.id)
                .get();
              
              if (contactDoc.exists) {
                const contactData = contactDoc.data();
                const currentActiveSalespeople = contactData?.activeSalespeople || {};
                
                const updatedActiveSalespeople = {
                  ...currentActiveSalespeople,
                  [userId]: {
                    id: userId,
                    displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                    email: userData?.email || '',
                    lastActiveAt: emailDate.getTime(),
                    _processedBy: 'gmail_integration',
                    _processedAt: admin.firestore.FieldValue.serverTimestamp()
                  }
                };
                
                await db.collection('tenants').doc(tenantId)
                  .collection('crm_contacts')
                  .doc(contact.id)
                  .set({
                    activeSalespeople: updatedActiveSalespeople,
                    activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                  }, { merge: true });
                
                console.log(`✅ Updated active salespeople for contact ${contact.id} to include user ${userId}`);
              }
            } catch (salespersonError) {
              console.warn(`Failed to update active salespeople for contact ${contact.id}:`, salespersonError);
            }

            // Update active salespeople for associated companies
            for (const companyId of associatedEntities.companies) {
              try {
                const companyDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_companies')
                  .doc(companyId)
                  .get();
                
                if (companyDoc.exists) {
                  const companyData = companyDoc.data();
                  const currentActiveSalespeople = companyData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: emailDate.getTime(),
                      _processedBy: 'gmail_integration',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_companies')
                    .doc(companyId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for company ${companyId} to include user ${userId}`);
                }
              } catch (companyError) {
                console.warn(`Failed to update active salespeople for company ${companyId}:`, companyError);
              }
            }

            // Update active salespeople for associated locations
            for (const locationId of associatedEntities.locations) {
              try {
                // Find the company that owns this location
                const locationDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_companies')
                  .doc(contact.companyId || '')
                  .collection('locations')
                  .doc(locationId)
                  .get();
                
                if (locationDoc.exists) {
                  const locationData = locationDoc.data();
                  const currentActiveSalespeople = locationData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: emailDate.getTime(),
                      _processedBy: 'gmail_integration',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_companies')
                    .doc(contact.companyId || '')
                    .collection('locations')
                    .doc(locationId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for location ${locationId} to include user ${userId}`);
                }
              } catch (locationError) {
                console.warn(`Failed to update active salespeople for location ${locationId}:`, locationError);
              }
            }

            // Update active salespeople for associated deals
            for (const dealId of associatedEntities.deals) {
              try {
                const dealDoc = await db.collection('tenants').doc(tenantId)
                  .collection('crm_deals')
                  .doc(dealId)
                  .get();
                
                if (dealDoc.exists) {
                  const dealData = dealDoc.data();
                  const currentActiveSalespeople = dealData?.activeSalespeople || {};
                  
                  const updatedActiveSalespeople = {
                    ...currentActiveSalespeople,
                    [userId]: {
                      id: userId,
                      displayName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
                      email: userData?.email || '',
                      lastActiveAt: emailDate.getTime(),
                      _processedBy: 'gmail_integration',
                      _processedAt: admin.firestore.FieldValue.serverTimestamp()
                    }
                  };
                  
                  await db.collection('tenants').doc(tenantId)
                    .collection('crm_deals')
                    .doc(dealId)
                    .set({
                      activeSalespeople: updatedActiveSalespeople,
                      activeSalespeopleUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                  
                  console.log(`✅ Updated active salespeople for deal ${dealId} to include user ${userId}`);
                }
              } catch (dealError) {
                console.warn(`Failed to update active salespeople for deal ${dealId}:`, dealError);
              }
            }

            // Create email logs for all associated entities to enable "filter up" functionality
            const emailLogBase = {
              messageId: message.id,
              threadId: messageData.threadId,
              subject,
              from,
              to: to.split(',').map(e => e.trim()).filter(Boolean),
              cc: cc.split(',').map(e => e.trim()).filter(Boolean),
              bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
              timestamp: emailDate,
              bodySnippet: bodySnippet.substring(0, 250),
              direction: isOutbound ? 'outbound' : 'inbound',
              contactId: contact.id,
              userId,
              isDraft: messageData.labelIds?.includes('DRAFT') || false,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            // Create email log for contact (primary)
            const contactEmailLog = {
              ...emailLogBase,
              companyId: contact.companyId,
              dealId
            };
            await db.collection('tenants').doc(tenantId)
              .collection('email_logs')
              .add(contactEmailLog);

            // Create email logs for associated companies
            for (const companyId of associatedEntities.companies) {
              const companyEmailLog = {
                ...emailLogBase,
                companyId,
                dealId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(companyEmailLog);
            }

            // Create email logs for associated locations (these will appear in location activity tabs)
            for (const locationId of associatedEntities.locations) {
              const locationEmailLog = {
                ...emailLogBase,
                companyId: contact.companyId,
                dealId,
                locationId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(locationEmailLog);
            }

            // Create email logs for associated deals
            for (const dealId of associatedEntities.deals) {
              const dealEmailLog = {
                ...emailLogBase,
                companyId: contact.companyId,
                dealId
              };
              await db.collection('tenants').doc(tenantId)
                .collection('email_logs')
                .add(dealEmailLog);
            }

            console.log(`✅ Created email logs for contact ${contact.id} and ${associatedEntities.companies.size} companies, ${associatedEntities.locations.size} locations, ${associatedEntities.deals.size} deals`);

            console.log(`✅ Created activity log for contact ${contact.id} (${contact.email})`);

            activityLogsCreated++;

            // Also log to AI system for analytics
            try {
              const { logAIAction } = await import('./utils/aiLogging');
              await logAIAction({
                eventType: 'email.sent_to_contact',
                targetType: 'contact',
                targetId: contact.id,
                reason: `Email sent to contact: ${subject}`,
                contextType: 'email_activity',
                aiTags: ['email', 'contact_activity', 'outbound'],
                urgencyScore: 3,
                inputPrompt: `Email sent to ${contact.email}: ${subject}`,
                composedPrompt: `Email activity logged for contact ${contact.fullName || contact.email}`,
                aiResponse: `Activity logged for email: ${subject}`,
                success: true,
                tenantId,
                userId,
                associations: {
                  contacts: [contact.id],
                  deals: dealId ? [dealId] : [],
                  companies: contact.companyId ? [contact.companyId] : []
                },
                metadata: {
                  emailSubject: subject,
                  contactEmail: contact.email,
                  gmailMessageId: message.id
                }
              });
            } catch (aiLogError) {
              console.warn('Failed to log AI activity for email:', aiLogError);
            }

          } catch (contactError) {
            console.error(`Error processing contact ${contact.id} for email ${message.id}:`, contactError);
          }
        }

        // Record processed summary for logging purposes
        processedSummaries.push({
          messageId: message.id!,
          subject: subject || '',
          direction: isOutbound ? 'outbound' : 'inbound',
          emailDate: emailDate.toISOString(),
          from,
          to: to.split(',').map((e: string) => e.trim()).filter(Boolean),
          cc: cc.split(',').map((e: string) => e.trim()).filter(Boolean),
          bcc: bcc.split(',').map((e: string) => e.trim()).filter(Boolean),
          contactEmails,
          contactsFound: contacts.length
        });

        // Update the latest processed time
        if (emailDate > latestProcessedTime) {
          latestProcessedTime = emailDate;
        }

        processedCount++;

      } catch (messageError) {
        console.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    } // End of for loop for messages
    
    } while (nextPageToken); // End of do-while loop for pagination

    // Update the processing state to track the latest processed time
    await db.collection('tenants').doc(tenantId)
      .collection('gmail_processing_state')
      .doc(userId)
      .set({
        lastProcessedTime: latestProcessedTime,
        lastProcessedAt: new Date(),
        userId,
        tenantId
      }, { merge: true });

    console.log(`📊 Processing summary: ${processedCount} emails processed, ${activityLogsCreated} activity logs created`);
    console.log(`⏰ Updated last processed time to: ${latestProcessedTime.toISOString()}`);

    return {
      success: true,
      processedCount,
      activityLogsCreated,
      message: `Processed ${processedCount} emails, created ${activityLogsCreated} activity logs`,
      processedSummaries
    };

  } catch (error) {
    console.error('Error monitoring Gmail for contact emails:', error);
    return {
      success: false,
      message: `Failed to monitor Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Scheduled function to automatically monitor Gmail for contact emails
 * Runs every 60 minutes (reduced from 15 minutes to reduce function calls)
 */
export const scheduledGmailMonitoring = onSchedule({
  // Run every 60 minutes to reduce function call frequency
  schedule: 'every 60 minutes',
  timeZone: 'America/New_York'
}, async (context) => {
  try {
    console.log('🔄 Starting scheduled Gmail monitoring...');
    
    // Get all users with Gmail connected
    const usersSnapshot = await db.collection('users')
      .where('gmailConnected', '==', true)
      .get();
    
    if (usersSnapshot.empty) {
      console.log('No users with Gmail connected found');
      return;
    }
    
    console.log(`Found ${usersSnapshot.docs.length} users with Gmail connected`);
    
    let totalProcessed = 0;
    let totalActivityLogs = 0;
    
    // Process each user
    const now = new Date();
    const deepScan = now.getMinutes() < 5; // within first 5 minutes of the hour run deep
    const deepScanHours = 12; // scan back 12 hours on deep runs for completeness
    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        
        // Get user's tenant ID (you might need to adjust this based on your user structure)
        const tenantId = userData.tenantId || userData.defaultTenantId;
        
        if (!tenantId) {
          console.log(`No tenant ID found for user ${userId}, skipping`);
          continue;
        }
        
        console.log(`Processing user ${userId} for tenant ${tenantId}`);
        
        // Call the monitoring function for this user
        try {
          const result = await monitorGmailForContactEmailsInternal(
            userId,
            tenantId,
            100,
            deepScan ? { deepScanHours } : undefined
          );
          if (result.success) {
            totalProcessed += result.processedCount || 0;
            totalActivityLogs += result.activityLogsCreated || 0;
            console.log(`✅ User ${userId}: ${result.processedCount} emails processed, ${result.activityLogsCreated} activity logs created`);
            // Log email address details when emails were found
            if ((result.processedCount || 0) > 0 && Array.isArray(result.processedSummaries)) {
              for (const s of result.processedSummaries.slice(0, 50)) { // cap to avoid huge logs
                console.log(`📧 Email summary for user ${userId}:`, {
                  messageId: s.messageId,
                  subject: s.subject,
                  direction: s.direction,
                  emailDate: s.emailDate,
                  from: s.from,
                  to: s.to,
                  cc: s.cc,
                  bcc: s.bcc,
                  contactEmails: s.contactEmails,
                  contactsFound: s.contactsFound
                });
              }
            }
          } else {
            console.error(`❌ User ${userId}: ${result.message || 'Unknown error'}`);
          }
        } catch (error) {
          console.error(`❌ Error processing user ${userId}:`, error);
        }
        
      } catch (userError) {
        console.error(`Error processing user ${userDoc.id}:`, userError);
        // Continue with next user
      }
    }
    
    console.log(`🎉 Scheduled Gmail monitoring completed: ${totalProcessed} emails processed, ${totalActivityLogs} activity logs created`);
    
  } catch (error) {
    console.error('❌ Error in scheduled Gmail monitoring:', error);
  }
});

/**
 * Cleanup function to remove duplicate email activity logs
 * This should be run once to clean up any duplicates created before the fix
 */
export const cleanupDuplicateEmailLogs = onCall({
  cors: true,
  maxInstances: 1,
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300
}, async (request) => {
  try {
    const { tenantId, userId, maxRuntimeMs = 45000 } = request.data as any;

    if (!tenantId) {
      throw new Error('Missing required field: tenantId');
    }

    console.log(`🧹 Starting cleanup of duplicate email logs for tenant ${tenantId}${userId ? ` and user ${userId}` : ''}`);

    let totalRemoved = 0;
    let activityRemoved = 0;
    let emailRemoved = 0;
    const startTime = Date.now();
    let hasMore = false;

    // Clean up duplicate activity logs - enhanced approach
    try {
      console.log('🔍 Checking for duplicate activity logs...');
      const activityLogsRef = db.collection('tenants').doc(tenantId).collection('activity_logs');
      const activityQuery = activityLogsRef.where('activityType', '==', 'email');

      const activitySnapshot = await activityQuery.get();
      console.log(`📊 Found ${activitySnapshot.docs.length} total activity logs`);
      
      const messageIdGroups = new Map<string, any[]>();
      const timestampGroups = new Map<string, any[]>();

      // Group activity logs by gmailMessageId and timestamp
      activitySnapshot.docs.forEach(doc => {
        const data = doc.data();
        const messageId = data.metadata?.gmailMessageId;
        const timestamp = data.timestamp;
        const description = data.description || '';
        
        // Group by messageId (existing logic)
        if (messageId) {
          if (!messageIdGroups.has(messageId)) {
            messageIdGroups.set(messageId, []);
          }
          messageIdGroups.get(messageId)!.push({ id: doc.id, ...data });
        }
        
        // Group by timestamp + description (new logic for timestamp-based duplicates)
        if (timestamp && description) {
          const timeKey = `${timestamp}_${description.substring(0, 50)}`; // Use first 50 chars of description
          if (!timestampGroups.has(timeKey)) {
            timestampGroups.set(timeKey, []);
          }
          timestampGroups.get(timeKey)!.push({ id: doc.id, ...data });
        }
      });

      console.log(`📊 Found ${messageIdGroups.size} unique message IDs and ${timestampGroups.size} unique timestamp groups in activity logs`);

      // Remove messageId-based duplicates
      for (const [messageId, logs] of messageIdGroups) {
        if (logs.length > 1) {
          console.log(`🗑️ Found ${logs.length} duplicate activity logs for message ${messageId}`);
          
          // Sort by creation time and keep the oldest one
          logs.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || a.createdAt?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || b.createdAt?.getTime() || 0;
            return aTime - bTime;
          });
          
          // Remove all but the first one
          for (let i = 1; i < logs.length; i++) {
            await db.collection('tenants').doc(tenantId).collection('activity_logs').doc(logs[i].id).delete();
            activityRemoved++;
            totalRemoved++;
          }
        }
      }
      
      // Remove timestamp-based duplicates
      for (const [timeKey, logs] of timestampGroups) {
        if (logs.length > 1) {
          const [timestamp, description] = timeKey.split('_', 2);
          console.log(`🗑️ Found ${logs.length} timestamp-based duplicate activity logs for "${description}" at ${timestamp}`);
          
          // Sort by creation time and keep the oldest one
          logs.sort((a, b) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || a.createdAt?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || b.createdAt?.getTime() || 0;
            return aTime - bTime;
          });
          
          // Remove all but the first one
          for (let i = 1; i < logs.length; i++) {
            await db.collection('tenants').doc(tenantId).collection('activity_logs').doc(logs[i].id).delete();
            activityRemoved++;
            totalRemoved++;
          }
        }
      }
      // cooperative time slicing for activity logs
      if (Date.now() - startTime > maxRuntimeMs) {
        hasMore = true;
      }
    } catch (activityError) {
      console.error('❌ Error cleaning up activity logs:', activityError);
    }

    // Clean up duplicate email logs - memory-efficient approach
    try {
      console.log('🔍 Checking for duplicate email logs...');
      const emailLogsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
      
      // Process in batches to avoid memory issues. Some historical docs use different field names,
      // so we run up to three passes ordered by createdAt, date, then timestamp.
      const orderFields = ['createdAt', 'date', 'timestamp'] as const;
      const batchSize = 100;
      let totalProcessed = 0;

      for (const orderField of orderFields) {
        let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;
        let hasMore = true;
        let passProcessed = 0;

        while (hasMore) {
          try {
            let q = emailLogsRef.orderBy(orderField as any, 'asc').limit(batchSize);
            if (lastDoc) q = q.startAfter(lastDoc);
            const emailSnapshot = await q.get();
            console.log(`📊 [${orderField}] Processing batch of ${emailSnapshot.docs.length} email logs (total processed: ${totalProcessed})`);

            if (emailSnapshot.empty) {
              hasMore = false;
              break;
            }

            // Process this batch - enhanced duplicate detection with normalization
            const emailMessageIdGroups = new Map<string, any[]>();
            const emailTimestampGroups = new Map<string, any[]>();

            emailSnapshot.docs.forEach(doc => {
              const data = doc.data() as any;
              const messageId = data.gmailMessageId || data.messageId;

              // Normalize timestamp
              const ts: Date = (data.date?.toDate?.() || data.timestamp?.toDate?.() || data.createdAt?.toDate?.() || data.processedAt?.toDate?.() || new Date(0)) as Date;

              // Normalize recipients
              let recipients: string[] = [];
              if (Array.isArray(data.to)) recipients = data.to as string[];
              else if (typeof data.to === 'string') recipients = extractEmailAddresses(data.to);
              else if (Array.isArray(data.emailAddresses)) recipients = (data.emailAddresses as string[]);
              else if (typeof data.recipient === 'string') recipients = extractEmailAddresses(data.recipient);
              const recipientKey = recipients.map(r => r.toLowerCase().trim()).sort().join(',');

              if (messageId) {
                if (!emailMessageIdGroups.has(messageId)) emailMessageIdGroups.set(messageId, []);
                emailMessageIdGroups.get(messageId)!.push({ id: doc.id, ...data, __ts: ts });
              }

              if (ts && recipientKey) {
                const timeKey = `${ts.getTime()}_${recipientKey}`;
                if (!emailTimestampGroups.has(timeKey)) emailTimestampGroups.set(timeKey, []);
                emailTimestampGroups.get(timeKey)!.push({ id: doc.id, ...data, __ts: ts });
              }
            });

            const sortByOldest = (a: any, b: any) => {
              const aTime = a.createdAt?.toDate?.()?.getTime?.() || a.__ts?.getTime?.() || 0;
              const bTime = b.createdAt?.toDate?.()?.getTime?.() || b.__ts?.getTime?.() || 0;
              return aTime - bTime;
            };

            // Remove messageId-based duplicates
            for (const [msgId, logs] of emailMessageIdGroups) {
              if (logs.length > 1) {
                console.log(`🗑️ Found ${logs.length} duplicate email logs for message ${msgId} in current batch`);
                logs.sort(sortByOldest);
                for (let i = 1; i < logs.length; i++) {
                  await db.collection('tenants').doc(tenantId).collection('email_logs').doc(logs[i].id).delete();
                  emailRemoved++; totalRemoved++;
                }
              }
            }

            // Remove timestamp-based duplicates
            for (const [timeKey, logs] of emailTimestampGroups) {
              if (logs.length > 1) {
                console.log(`🗑️ Found ${logs.length} timestamp-based duplicate email logs for key ${timeKey} in current batch`);
                logs.sort(sortByOldest);
                for (let i = 1; i < logs.length; i++) {
                  await db.collection('tenants').doc(tenantId).collection('email_logs').doc(logs[i].id).delete();
                  emailRemoved++; totalRemoved++;
                }
              }
            }

            lastDoc = emailSnapshot.docs[emailSnapshot.docs.length - 1];
            totalProcessed += emailSnapshot.docs.length;
            passProcessed += emailSnapshot.docs.length;

            if (emailSnapshot.docs.length < batchSize) hasMore = false;
            await new Promise(resolve => setTimeout(resolve, 25));

            // time slice guard
            if (Date.now() - startTime > maxRuntimeMs) {
              hasMore = false;
              break;
            }

          } catch (passError: any) {
            console.warn(`⚠️ Skipping pass ordered by ${orderField}:`, passError?.message || passError);
            hasMore = false;
          }
        }

        console.log(`📊 Completed pass ordered by ${orderField}: processed ${passProcessed} docs`);
        if (Date.now() - startTime > maxRuntimeMs) {
          hasMore = true;
          break;
        }
      }
      
      console.log(`📊 Completed processing ${totalProcessed} email logs in batches`);
    } catch (emailError) {
      console.error('❌ Error cleaning up email logs:', emailError);
    }

    console.log(`✅ Cleanup completed slice: ${totalRemoved} duplicate logs removed (${activityRemoved} activity logs, ${emailRemoved} email logs). hasMore=${hasMore}`);

    return {
      success: true,
      totalRemoved,
      activityRemoved,
      emailRemoved,
      hasMore,
      message: `Removed ${totalRemoved} duplicate logs this run (${activityRemoved} activity logs, ${emailRemoved} email logs)`
    };

  } catch (error) {
    console.error('❌ Error cleaning up duplicate email logs:', error);
    return {
      success: false,
      message: `Failed to cleanup duplicates: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
});