import { onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
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

/**
 * Get Gmail connection status for a user
 */
export const getGmailStatus = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId } = request.data;

    if (!userId) {
      throw new Error('Missing required field: userId');
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

    console.log('Gmail status result:', { connected, email, lastSync, syncStatus });

    return {
      connected,
      email,
      lastSync,
      syncStatus
    };
  } catch (error) {
    console.error('Error getting Gmail status:', error);
    throw new Error(`Failed to get Gmail status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}); 

/**
 * Monitor Gmail for new sent emails and log them as contact activities
 * This function should be called periodically (e.g., every 15 minutes) to check for new emails
 */
export const monitorGmailForContactEmails = onCall({
  cors: true
}, async (request) => {
  try {
    const { userId, tenantId, maxResults = 20 } = request.data;

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

    // Get recent sent messages (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = `from:${userData?.email || userData?.gmailTokens?.email} after:${Math.floor(oneDayAgo.getTime() / 1000)}`;

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query
    });

    const messages = messagesResponse.data.messages || [];
    let processedCount = 0;
    let activityLogsCreated = 0;

    // Process each sent message
    for (const message of messages) {
      try {
        // Check if this email activity has already been logged
        const existingActivity = await db.collection('tenants').doc(tenantId)
          .collection('activity_logs')
          .where('gmailMessageId', '==', message.id)
          .limit(1)
          .get();

        if (!existingActivity.empty) {
          continue; // Skip if already logged
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

        // Find contacts in the recipient list
        const allRecipients = [to, cc, bcc].flat().filter(Boolean);
        const contactEmails = allRecipients.map(email => email.trim());
        
        // Find contacts in CRM
        const contactQuery = await db.collection('tenants').doc(tenantId)
          .collection('crm_contacts')
          .where('email', 'in', contactEmails)
          .get();

        if (contactQuery.empty) {
          continue; // No contacts found, skip this email
        }

        const contacts = contactQuery.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as any[];

        // Create activity log for each contact
        for (const contact of contacts) {
          try {
            // Find associated deals for this contact
            let dealId = null;
            const dealQuery = await db.collection('tenants').doc(tenantId)
              .collection('crm_deals')
              .where('associations.contacts', 'array-contains', contact.id)
              .orderBy('updatedAt', 'desc')
              .limit(1)
              .get();

            if (!dealQuery.empty) {
              dealId = dealQuery.docs[0].id;
            }

            // Create activity log
            const activityLog = {
              tenantId,
              entityType: 'contact',
              entityId: contact.id,
              activityType: 'email',
              title: `Email sent: ${subject}`,
              description: bodySnippet.substring(0, 200) + (bodySnippet.length > 200 ? '...' : ''),
              timestamp: new Date(date),
              userId,
              userName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
              metadata: {
                emailSubject: subject,
                emailFrom: from,
                emailTo: to,
                emailCc: cc,
                emailBcc: bcc,
                direction: 'outbound',
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

            // Also create an entry in email_logs collection for consistency with Contact Activity tab
            const emailLog = {
              messageId: message.id,
              threadId: messageData.threadId,
              subject,
              from,
              to: to.split(',').map(e => e.trim()).filter(Boolean),
              cc: cc.split(',').map(e => e.trim()).filter(Boolean),
              bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
              timestamp: new Date(date),
              bodySnippet: bodySnippet.substring(0, 250),
              direction: 'outbound',
              contactId: contact.id,
              companyId: contact.companyId,
              dealId,
              userId,
              isDraft: messageData.labelIds?.includes('DRAFT') || false,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            await db.collection('tenants').doc(tenantId)
              .collection('email_logs')
              .add(emailLog);

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

        processedCount++;

      } catch (messageError) {
        console.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    }

    return {
      success: true,
      processedCount,
      activityLogsCreated,
      message: `Processed ${processedCount} emails, created ${activityLogsCreated} activity logs`
    };

  } catch (error) {
    console.error('Error monitoring Gmail for contact emails:', error);
    throw new Error(`Failed to monitor Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

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
async function monitorGmailForContactEmailsInternal(userId: string, tenantId: string, maxResults: number = 20) {
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
    if (lastProcessedDoc.exists) {
      lastProcessedTime = lastProcessedDoc.data()?.lastProcessedTime?.toDate() || new Date(Date.now() - 30 * 60 * 1000); // Default to 30 minutes ago
    } else {
      // If no previous processing record, start from 30 minutes ago to catch recent emails
      lastProcessedTime = new Date(Date.now() - 30 * 60 * 1000);
    }

    const userEmail = userData?.email || userData?.gmailTokens?.email;
    
    // Use the last processed time to avoid duplicates
    const query = `in:sent after:${Math.floor(lastProcessedTime.getTime() / 1000)}`;
    
    console.log(`🔍 Searching for sent emails with query: "${query}"`);
    console.log(`📧 User email: ${userEmail}`);
    console.log(`⏰ Last processed time: ${lastProcessedTime.toISOString()}`);

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query
    });

    const messages = messagesResponse.data.messages || [];
    console.log(`📨 Found ${messages.length} sent messages since last processing`);
    
    if (messages.length === 0) {
      console.log('📭 No new messages to process');
      return {
        success: true,
        processedCount: 0,
        activityLogsCreated: 0,
        message: 'No new messages to process'
      };
    }

    let processedCount = 0;
    let activityLogsCreated = 0;
    let latestProcessedTime = lastProcessedTime;

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
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const emailDate = new Date(date);

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

        // Find contacts in the recipient list
        const allRecipients = [to, cc, bcc].flat().filter(Boolean);
        const contactEmails = allRecipients.flatMap(email => extractEmailAddresses(email));
        
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
        const contactQuery = await db.collection('tenants').doc(tenantId)
          .collection('crm_contacts')
          .where('email', 'in', contactEmails)
          .get();

        // Debug: Log contact matching results
        console.log(`📧 Contact matching for message ${message.id}:`, {
          emailsSearched: contactEmails,
          contactsFound: contactQuery.docs.length,
          contactDetails: contactQuery.docs.map(doc => ({
            id: doc.id,
            email: doc.data().email,
            name: doc.data().fullName || `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim()
          }))
        });

        if (contactQuery.empty) {
          console.log(`❌ No contacts found for message ${message.id}, skipping...`);
          // Update the latest processed time even for emails without contacts
          if (emailDate > latestProcessedTime) {
            latestProcessedTime = emailDate;
          }
          continue; // No contacts found, skip this email
        }

        const contacts = contactQuery.docs.map(doc => ({
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
              title: `Email sent: ${subject}`,
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
                direction: 'outbound',
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

            // Also create an entry in email_logs collection for consistency with Contact Activity tab
            const emailLog = {
              messageId: message.id,
              threadId: messageData.threadId,
              subject,
              from,
              to: to.split(',').map(e => e.trim()).filter(Boolean),
              cc: cc.split(',').map(e => e.trim()).filter(Boolean),
              bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
              timestamp: emailDate,
              bodySnippet: bodySnippet.substring(0, 250),
              direction: 'outbound',
              contactId: contact.id,
              companyId: contact.companyId,
              dealId,
              userId,
              isDraft: messageData.labelIds?.includes('DRAFT') || false,
              createdAt: new Date(),
              updatedAt: new Date()
            };

            await db.collection('tenants').doc(tenantId)
              .collection('email_logs')
              .add(emailLog);

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

        // Update the latest processed time
        if (emailDate > latestProcessedTime) {
          latestProcessedTime = emailDate;
        }

        processedCount++;

      } catch (messageError) {
        console.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    }

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
      message: `Processed ${processedCount} emails, created ${activityLogsCreated} activity logs`
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
 * Runs every 15 minutes
 */
export const scheduledGmailMonitoring = onSchedule({
  schedule: 'every 15 minutes',
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
          const result = await monitorGmailForContactEmailsInternal(userId, tenantId, 10);
          if (result.success) {
            totalProcessed += result.processedCount || 0;
            totalActivityLogs += result.activityLogsCreated || 0;
            console.log(`✅ User ${userId}: ${result.processedCount} emails processed, ${result.activityLogsCreated} activity logs created`);
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
              hasMore = false;
              // signal we have more to do in next call
              // outer scope
              // @ts-ignore
              arguments; // noop to keep linter happy for block
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