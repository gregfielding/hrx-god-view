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
 * Helper function to extract email addresses from Gmail format
 * Handles formats like: "Name <email@domain.com>", "email@domain.com", "Name email@domain.com"
 */
function extractEmailAddress(emailString: string): string {
  if (!emailString) return '';
  
  // Remove quotes if present
  emailString = emailString.replace(/^["']|["']$/g, '');
  
  // Check for format: "Name <email@domain.com>"
  const match = emailString.match(/<(.+?)>/);
  if (match) {
    return match[1].trim();
  }
  
  // Check for format: "Name email@domain.com" (no angle brackets)
  const parts = emailString.split(' ');
  const lastPart = parts[parts.length - 1];
  if (lastPart.includes('@')) {
    return lastPart.trim();
  }
  
  // If no special format, return as is
  return emailString.trim();
}

/**
 * Helper function to extract all email addresses from a comma-separated list
 */
function extractEmailAddresses(emailList: string): string[] {
  if (!emailList) return [];
  
  return emailList
    .split(',')
    .map(email => extractEmailAddress(email))
    .filter(email => email && email.includes('@'));
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

    // Get recent sent messages (last 7 days for testing)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const userEmail = userData?.email || userData?.gmailTokens?.email;
    
    // Use the correct query for sent emails - look in Sent folder
    const query = `in:sent after:${Math.floor(sevenDaysAgo.getTime() / 1000)}`;
    
    console.log(`🔍 Searching for sent emails with query: "${query}"`);
    console.log(`📧 User email: ${userEmail}`);

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query
    });

    const messages = messagesResponse.data.messages || [];
    console.log(`📨 Found ${messages.length} sent messages in the last 7 days`);
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
        const contactEmails = allRecipients.flatMap(email => extractEmailAddresses(email));
        
        // Debug: Log email parsing
        console.log(`🔍 Email parsing for message ${message.id}:`, {
          subject,
          from,
          to,
          cc,
          bcc,
          allRecipients,
          contactEmails
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
          // Let's also check what contacts exist in the CRM to debug
          const allContacts = await db.collection('tenants').doc(tenantId)
            .collection('crm_contacts')
            .limit(10)
            .get();
          console.log(`🔍 Available contacts in CRM (first 10):`, allContacts.docs.map(doc => ({
            id: doc.id,
            email: doc.data().email,
            name: doc.data().fullName || `${doc.data().firstName || ''} ${doc.data().lastName || ''}`.trim()
          })));
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