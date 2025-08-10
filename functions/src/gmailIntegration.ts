import { onCall, onRequest } from 'firebase-functions/v2/https';
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