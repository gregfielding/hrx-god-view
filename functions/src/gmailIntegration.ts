import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { google } from 'googleapis';
import { logger } from './utils/logger';
import { logMessage } from './messaging/messageLogging';
import { findOrCreateEmailThread, addMessageToThread } from './messaging/emailThreading';
import { getStorage } from 'firebase-admin/storage';
import { getStorageBucketName } from './utils/storageBucket';


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

function emailFromIdToken(idToken?: string | null): string {
  if (!idToken) return '';
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    ) as { email?: string };
    return payload?.email || '';
  } catch {
    return '';
  }
}

async function resolveGoogleEmailFromTokens(tokens: any): Promise<string> {
  const fromIdToken = emailFromIdToken(tokens?.id_token);
  if (fromIdToken) {
    return fromIdToken;
  }
  try {
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    return profile.data.emailAddress || '';
  } catch (error: any) {
    // Do not fail OAuth callback on profile lookup rate limits.
    logger.warn('Unable to resolve Gmail profile email during OAuth callback', {
      status: error?.code || error?.status,
      reason: error?.errors?.[0]?.reason,
      message: error?.message,
    });
    return '';
  }
}

function getErrorMessage(error: any): string {
  return String(error?.message || error?.error?.message || error || '');
}

function isGmailTokenError(error: any): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes('invalid_grant') ||
    msg.includes('token has been expired') ||
    msg.includes('token expired') ||
    msg.includes('invalid credentials') ||
    msg.includes('access has expired')
  );
}

function isGmailRateLimitError(error: any): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  const reason = String(error?.errors?.[0]?.reason || '').toLowerCase();
  const status = Number(error?.code || error?.status || 0);
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('user-rate limit exceeded') ||
    reason.includes('ratelimit') ||
    reason.includes('quota')
  );
}

/**
 * Gmail message bodies are base64url encoded. Normalize to base64 before decoding.
 */
function decodeGmailBody(data?: string): string {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString();
  } catch {
    // Best effort: return empty to fall back to snippet
    return '';
  }
}

function safeFilename(input: string): string {
  return (input || 'attachment')
    .replace(/[^\w.\-() ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function collectAllParts(payload: any, out: any[] = []): any[] {
  if (!payload) return out;
  out.push(payload);
  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    collectAllParts(part, out);
  }
  return out;
}

// getStorageBucketName moved to ./utils/storageBucket

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const found = headers.find((h) => String(h.name || '').toLowerCase() === name.toLowerCase());
  return found?.value;
}

/**
 * Recursively find the first part matching one of the desired mime types.
 */
function findFirstMimePart(payload: any, mimeTypes: string[]): any | null {
  if (!payload) return null;
  if (payload.mimeType && mimeTypes.includes(payload.mimeType) && payload.body?.data) {
    return payload;
  }
  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    const found = findFirstMimePart(part, mimeTypes);
    if (found) return found;
  }
  return null;
}

/**
 * Extract HTML/plain bodies from a Gmail message payload.
 * Prefer HTML when present, but always return a reasonable plainText fallback.
 */
function extractBodiesFromPayload(messageData: any): { bodyHtml: string; bodyPlain: string } {
  const payload = messageData?.payload;
  let bodyHtml = '';
  let bodyPlain = '';

  // Single-part bodies can live on payload.body.data
  if (payload?.body?.data && payload?.mimeType) {
    if (payload.mimeType === 'text/html') bodyHtml = decodeGmailBody(payload.body.data);
    if (payload.mimeType === 'text/plain') bodyPlain = decodeGmailBody(payload.body.data);
  }

  // Multipart: recursively locate parts
  const htmlPart = findFirstMimePart(payload, ['text/html']);
  const plainPart = findFirstMimePart(payload, ['text/plain']);
  if (!bodyHtml && htmlPart?.body?.data) bodyHtml = decodeGmailBody(htmlPart.body.data);
  if (!bodyPlain && plainPart?.body?.data) bodyPlain = decodeGmailBody(plainPart.body.data);

  // Fallback to Gmail snippet (still truncated, but better than empty)
  if (!bodyPlain) bodyPlain = String(messageData?.snippet || '');
  return { bodyHtml, bodyPlain };
}

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
    
    // Best-effort email resolution (must not fail callback)
    const email = await resolveGoogleEmailFromTokens(tokens);
    
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

    // Best-effort email resolution (must not fail callback)
    const email = await resolveGoogleEmailFromTokens(tokens);

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
  cors: true,
  memory: '1GiB',          // Avoid OOM while processing message bodies
  concurrency: 10,         // Reduce per-instance load to prevent memory spikes
  timeoutSeconds: 540      // 9 minutes - allow time for processing large batches
}, async (request) => {
  try {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Must be signed in to sync Gmail.');
    }
    // Default to 1000 emails per sync
    const { userId, tenantId, maxResults = 1000 } = request.data;

    if (!userId || !tenantId) {
      throw new HttpsError('invalid-argument', 'Missing required fields: userId, tenantId');
    }
    if (request.auth.uid !== userId) {
      throw new HttpsError('permission-denied', 'Cannot sync Gmail for another user.');
    }

    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      throw new HttpsError('failed-precondition', 'Gmail not connected. Please authenticate first.');
    }

    // Set up Gmail API client
    oauth2Client.setCredentials(gmailTokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Test Gmail API access and verify which account we're querying
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const connectedEmail = profile.data.emailAddress;
      logger.info(`Gmail API access confirmed for ${connectedEmail}`);
      logger.info(`User's email in database: ${userData?.email || 'not set'}`);
      
      // Check if there's a mismatch
      if (userData?.email && userData.email.toLowerCase() !== connectedEmail?.toLowerCase()) {
        logger.warn(`Email mismatch: Database has ${userData.email}, but Gmail API is connected to ${connectedEmail}`);
      }
      
      // Try a simple query to see if we can access any messages at all
      const testQuery = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 1,
        q: '', // Empty query to get any message
      });
      logger.info(`Test query (empty) returned ${testQuery.data.messages?.length || 0} messages (resultSizeEstimate: ${testQuery.data.resultSizeEstimate})`);
      
      // Try querying inbox specifically
      const inboxQuery = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 1,
        q: 'in:inbox',
      });
      logger.info(`Inbox query returned ${inboxQuery.data.messages?.length || 0} messages (resultSizeEstimate: ${inboxQuery.data.resultSizeEstimate})`);
      
    } catch (profileError: any) {
      logger.error(`Gmail API access failed: ${profileError.message}`);
      const msg = getErrorMessage(profileError);
      throw new HttpsError('failed-precondition', `Gmail API access failed: ${msg}`);
    }
    
    // Get recent messages - prioritize unread, then recent emails
    // Use pagination to fetch all emails in batches
    const allMessages: any[] = [];
    let nextPageToken: string | undefined = undefined;
    let totalFetched = 0;
    const maxTotalResults = Math.min(maxResults, 1000); // Cap at 1000 emails per sync to avoid timeouts

    // First, try to get unread emails with pagination
    // Note: Removed 'is:email' filter as it was too restrictive - test queries show messages exist without it
    logger.info(`Querying Gmail for unread emails (maxResults: ${maxTotalResults})`);
    do {
      const query = 'is:unread';
      logger.info(`Gmail API query: "${query}", pageToken: ${nextPageToken ? 'present' : 'none'}`);
      
      const messagesResponse = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(500, maxTotalResults - totalFetched), // Gmail API max is 500 per request
        q: query, // Unread messages first
        pageToken: nextPageToken,
      });

      const batchMessages = messagesResponse.data.messages || [];
      logger.info(`Gmail API returned ${batchMessages.length} messages (resultSizeEstimate: ${messagesResponse.data.resultSizeEstimate})`);
      allMessages.push(...batchMessages);
      totalFetched += batchMessages.length;
      nextPageToken = messagesResponse.data.nextPageToken;

      // Stop if we've reached the max or no more pages
      if (totalFetched >= maxTotalResults || !nextPageToken) {
        break;
      }
    } while (nextPageToken && totalFetched < maxTotalResults);

    // If we haven't reached the max, get more emails from inbox (including old emails)
    // This ensures we sync historical emails, not just unread ones
    if (totalFetched < maxTotalResults) {
      logger.info(`Fetching inbox messages to reach ${maxTotalResults} total (already have ${totalFetched} unread)...`);
      nextPageToken = undefined;
      do {
        const query = 'in:inbox';
        logger.info(`Gmail API query: "${query}", pageToken: ${nextPageToken ? 'present' : 'none'}`);
        
        const messagesResponse = await gmail.users.messages.list({
          userId: 'me',
          maxResults: Math.min(500, maxTotalResults - totalFetched),
          q: query, // All inbox messages (including old ones)
          pageToken: nextPageToken,
        });

        const batchMessages = messagesResponse.data.messages || [];
        logger.info(`Gmail API returned ${batchMessages.length} messages (resultSizeEstimate: ${messagesResponse.data.resultSizeEstimate})`);
        
        // Add messages, avoiding duplicates (unread messages might also be in inbox)
        const existingIds = new Set(allMessages.map(m => m.id));
        const newMessages = batchMessages.filter(m => !existingIds.has(m.id));
        allMessages.push(...newMessages);
        totalFetched += newMessages.length;
        nextPageToken = messagesResponse.data.nextPageToken;

        // Stop if we've reached the max or no more pages
        if (totalFetched >= maxTotalResults || !nextPageToken) {
          break;
        }
      } while (nextPageToken && totalFetched < maxTotalResults);
    }

    // Cap processing to avoid long runtimes
    const processingLimit = Math.min(allMessages.length, maxTotalResults);
    const messages = allMessages.slice(0, processingLimit);
    logger.info(`Found ${messages.length} messages to process for user ${userId}`);
    
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const newEmails = [];

    // Process each message
    for (const message of messages) {
      try {
        // Check if email already exists in email_logs
        const existingEmailLog = await db.collection('tenants').doc(tenantId)
          .collection('email_logs')
          .where('messageId', '==', message.id)
          .limit(1)
          .get();

        // Check if message exists in emailThreads (check by gmailMessageId in messages subcollection)
        // We'll check this by looking for threads with this gmailThreadId and then checking messages
        const threadQuery = await db.collection('tenants').doc(tenantId)
          .collection('emailThreads')
          .where('gmailThreadId', '==', message.threadId)
          .limit(1)
          .get();

        let messageExistsInThread = false;
        if (!threadQuery.empty) {
          const threadId = threadQuery.docs[0].id;
          const messageQuery = await db.collection('tenants').doc(tenantId)
            .collection('emailThreads').doc(threadId)
            .collection('messages')
            .where('gmailMessageId', '==', message.id)
            .limit(1)
            .get();
          messageExistsInThread = !messageQuery.empty;
        }

        // Always fetch metadata for this message so we can reconcile read/unread state.
        // (Gmail label changes are common; skipping here causes unread drift.)
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'full',
        });

        const messageData = messageResponse.data;
        
        // Skip chat messages (Gmail chats have "CHAT" label)
        if (messageData.labelIds?.includes('CHAT')) {
          skippedCount++;
          continue;
        }
        
        const headers = messageData.payload?.headers || [];
        
        // Extract email data
        const from = headers.find(h => h.name === 'From')?.value || '';
        const to = headers.find(h => h.name === 'To')?.value || '';
        const cc = headers.find(h => h.name === 'Cc')?.value || '';
        const bcc = headers.find(h => h.name === 'Bcc')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Extract bodies (recursive multipart-safe)
        const { bodyHtml, bodyPlain } = extractBodiesFromPayload(messageData);
        const bodySnippet = bodyPlain || String(messageData.snippet || '');

        // Determine direction
        const userEmail = userData?.email || '';
        const direction = from.includes(userEmail) ? 'outbound' : 'inbound';

        // Determine read state from Gmail labels.
        // Gmail uses the UNREAD label on messages; absence means read.
        const gmailLabelIds = messageData.labelIds || [];
        const isUnreadInGmail = gmailLabelIds.includes('UNREAD');
        const effectiveRead = direction === 'outbound' ? true : !isUnreadInGmail;

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
        // Robust timestamp: use Date header if valid, else Gmail internalDate
        const parsedDate = date ? new Date(date) : undefined;
        const internalDateMillis = messageData.internalDate ? Number(messageData.internalDate) : undefined;
        const timestamp =
          parsedDate && !isNaN(parsedDate.getTime())
            ? parsedDate
            : internalDateMillis
              ? new Date(internalDateMillis)
              : new Date();

        const emailLog = {
          messageId: message.id!,
          threadId: messageData.threadId!,
          subject,
          from,
          to: to.split(',').map(e => e.trim()).filter(Boolean),
          cc: cc.split(',').map(e => e.trim()).filter(Boolean),
          bcc: bcc.split(',').map(e => e.trim()).filter(Boolean),
          timestamp,
          bodySnippet: String(bodySnippet).substring(0, 250),
          bodyHtml: bodyHtml || undefined,
          direction,
          contactId: contactMap.size > 0 ? Array.from(contactMap.values())[0].id : null,
          companyId: contactMap.size > 0 ? Array.from(contactMap.values())[0].companyId : null,
          dealId,
          userId,
          isDraft: messageData.labelIds?.includes('DRAFT') || false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Save to Firestore (legacy email_logs for CRM integration)
        // Avoid duplicating legacy email_logs when we are only reconciling read/unread.
        if (existingEmailLog.empty) {
          await db.collection('tenants').doc(tenantId)
            .collection('email_logs')
            .add(emailLog);
        }

        // Create or find email thread and add message
        try {
          const thread = await findOrCreateEmailThread(tenantId, {
            subject,
            from,
            to: to.split(',').map(e => e.trim()).filter(Boolean),
            cc: cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
            gmailThreadId: messageData.threadId,
            gmailLabelIds: messageData.labelIds,
          }, {
            userId: direction === 'inbound' ? userId : undefined,
          });

          if (thread.id) {
            try {
              // If the message already exists in the thread, reconcile its read state.
              const existingMsgQuery = await db
                .collection('tenants')
                .doc(tenantId)
                .collection('emailThreads')
                .doc(thread.id)
                .collection('messages')
                .where('gmailMessageId', '==', message.id!)
                .limit(1)
                .get();

              if (!existingMsgQuery.empty) {
                const msgDoc = existingMsgQuery.docs[0];
                const existing = msgDoc.data() as any;
                const updates: any = {};
                if (typeof existing.read === 'boolean' && existing.read !== effectiveRead) {
                  updates.read = effectiveRead;
                  logger.info(
                    `Reconciled read state for gmailMessageId ${message.id} in thread ${thread.id}: ${existing.read} -> ${effectiveRead}`
                  );
                }
                // Backfill missing bodies (fixes truncated/cut-off renders for multipart emails)
                if ((!existing.bodyHtml || String(existing.bodyHtml).trim().length < 20) && bodyHtml) {
                  updates.bodyHtml = bodyHtml;
                }
                if ((!existing.bodyPlain || String(existing.bodyPlain).trim().length < 20) && bodyPlain) {
                  updates.bodyPlain = bodyPlain;
                }
                if ((!existing.bodySnippet || String(existing.bodySnippet).trim().length < 20) && bodySnippet) {
                  updates.bodySnippet = String(bodySnippet).substring(0, 200);
                }
                if (Object.keys(updates).length > 0) {
                  await msgDoc.ref.update(updates);
                }

                // Recompute thread unreadCount (best-effort) so counts converge even after label changes in Gmail.
                // This is a lightweight bounded query (inbound unread only).
                try {
                  const unreadSnap = await db
                    .collection('tenants')
                    .doc(tenantId)
                    .collection('emailThreads')
                    .doc(thread.id)
                    .collection('messages')
                    .where('direction', '==', 'inbound')
                    .where('read', '==', false)
                    .get();
                  await db
                    .collection('tenants')
                    .doc(tenantId)
                    .collection('emailThreads')
                    .doc(thread.id)
                    .set(
                      {
                        unreadCount: unreadSnap.size,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                      },
                      { merge: true }
                    );
                } catch (recountErr: any) {
                  logger.warn(`Failed to recompute unreadCount for thread ${thread.id}:`, recountErr);
                }
              } else {
                const messageId = await addMessageToThread(thread.id, tenantId, {
                  direction,
                  from,
                  fromUserId: direction === 'outbound' ? userId : undefined,
                  to: to.split(',').map(e => e.trim()).filter(Boolean),
                  cc: cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
                  subject,
                  bodyHtml: bodyHtml || undefined,
                  bodyPlain,
                  bodySnippet: String(bodyPlain || bodySnippet).substring(0, 200),
                  status: 'delivered',
                  providerMessageId: message.id!,
                  gmailMessageId: message.id!,
                  read: effectiveRead,
                  createdAt: timestamp, // Use the original email timestamp
                });
                logger.info(`Added message ${messageId} to thread ${thread.id} for email ${message.id}`);
              }
            } catch (messageError: any) {
              logger.error(`Failed to add message to thread ${thread.id}: ${messageError.message || messageError}`);
              // Continue processing other messages even if this one fails
            }
          }
        } catch (threadError) {
          // Don't fail sync if threading fails
          logger.error(`Failed to create email thread: ${threadError}`);
        }

        // Also log to unified messageLogs for inbox visibility
        // For inbound emails, userId is the recipient (the logged-in user)
        // For outbound emails, we'd need to determine the recipient from the 'to' field
        if (direction === 'inbound') {
          // Inbound email: logged-in user received it
          try {
            await logMessage({
              userId: userId, // The user who received the email
              tenantId,
              messageTypeId: 'inbound_message',
              channel: 'email',
              direction: 'inbound',
              fromIdentity: 'candidate', // Could be 'recruiter' or 'candidate' - defaulting to candidate
              contentOriginal: bodyHtml || bodySnippet,
              contentSent: bodySnippet.substring(0, 500), // Truncate for display
              language: null, // Could extract from email headers if needed
              status: 'delivered',
              providerMessageId: message.id!,
            });
          } catch (logError) {
            // Don't fail sync if logging fails
            logger.error(`Failed to log inbound email to messageLogs: ${logError}`);
          }
        } else {
          // Outbound email: need to find recipient from 'to' field
          // For now, we'll skip logging outbound emails here since they should be logged
          // when sent through the orchestrator. But we could add logic to find the recipient user.
        }

        if (existingEmailLog.empty) {
          newEmails.push(emailLog);
          syncedCount++;
        } else {
          skippedCount++;
        }
        
        if (syncedCount % 10 === 0) {
          logger.info(`Processed ${syncedCount} emails so far...`);
        }

      } catch (messageError: any) {
        errorCount++;
        logger.error(`Error processing message ${message.id}:`, messageError);
        // Continue with next message
      }
    }

    logger.info(`Sync completed: ${syncedCount} synced, ${skippedCount} skipped, ${errorCount} errors`);

    return {
      success: true,
      syncedCount,
      skippedCount,
      errorCount,
      totalProcessed: messages.length,
      newEmails: newEmails.length
    };

  } catch (error) {
    if (error instanceof HttpsError) throw error;
    const message = getErrorMessage(error);
    console.error('Error syncing Gmail emails:', error);
    if (isGmailRateLimitError(error)) {
      logger.warn('syncGmailEmails rate-limited; returning retryable response', { message });
      return {
        success: false,
        error: true,
        retryable: true,
        rateLimited: true,
        message: `Gmail API is rate-limited. Please retry shortly. ${message}`.trim(),
      };
    }
    throw new HttpsError('internal', `Failed to sync emails: ${message || 'Unknown error'}`);
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
 * Get Gmail unread count for INBOX (message count, not thread count).
 * Cached on the user doc to avoid rate limits.
 */
export const getGmailUnreadInboxCount = onCall(
  { cors: true, memory: '256MiB', concurrency: 20 },
  async (request) => {
    const { userId, maxAgeMs = 25000 } = request.data || {};
    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData: any = userDoc.data() || {};
    const cached = userData.gmailUnreadInboxCount;
    const cachedAt = userData.gmailUnreadInboxCountUpdatedAt;

    const cachedAtMs =
      cachedAt && typeof cachedAt.toMillis === 'function'
        ? cachedAt.toMillis()
        : cachedAt instanceof Date
          ? cachedAt.getTime()
          : typeof cachedAt === 'number'
            ? cachedAt
            : null;

    if (typeof cached === 'number' && cachedAtMs && Date.now() - cachedAtMs <= Number(maxAgeMs)) {
      return { success: true, unreadCount: cached, cached: true };
    }

    const gmailTokens = userData?.gmailTokens;
    if (!gmailTokens?.access_token) {
      return { success: true, unreadCount: 0, connected: false };
    }

    try {
      oauth2Client.setCredentials(gmailTokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // INBOX label has messagesUnread which matches Gmail’s sidebar unread count semantics.
      const labelRes = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
      const unreadCount = Number(labelRes.data.messagesUnread || 0);

      await userRef.set(
        {
          gmailUnreadInboxCount: unreadCount,
          gmailUnreadInboxCountUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { success: true, unreadCount, cached: false };
    } catch (err: any) {
      if (isGmailTokenError(err)) {
        logger.info('getGmailUnreadInboxCount: Gmail token expired or invalid', { userId });
        return { success: true, unreadCount: 0, connected: false };
      }
      if (isGmailRateLimitError(err)) {
        logger.warn('getGmailUnreadInboxCount: Gmail rate-limited; using fallback', { userId });
        return {
          success: true,
          unreadCount: typeof cached === 'number' ? cached : 0,
          cached: typeof cached === 'number',
          stale: typeof cached === 'number',
          rateLimited: true,
        };
      }
      throw err;
    }
  }
);

/**
 * Get Gmail mailbox counts for common labels/categories (thread totals + unread).
 * Used for Inbox category badge counts and Primary-only unread sidebar badge.
 *
 * Cached on the user doc to avoid rate limits.
 */
export const getGmailMailboxCounts = onCall(
  { cors: true, memory: '256MiB', concurrency: 20 },
  async (request) => {
    const { userId, maxAgeMs = 25000 } = request.data || {};
    if (!userId) {
      throw new Error('Missing required field: userId');
    }

    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      // New users may exist in Auth before their Firestore user doc is created.
      // This endpoint is used for non-critical UI badges; return safe defaults instead of throwing.
      const empty = {
        inbox: { threadsTotal: 0, threadsUnread: 0, messagesUnread: 0 },
        primary: { threadsTotal: 0, threadsUnread: 0 },
        social: { threadsTotal: 0, threadsUnread: 0 },
        promotions: { threadsTotal: 0, threadsUnread: 0 },
        updates: { threadsTotal: 0, threadsUnread: 0 },
        forums: { threadsTotal: 0, threadsUnread: 0 },
        spam: { threadsTotal: 0, threadsUnread: 0 },
        starred: { threadsTotal: 0, threadsUnread: 0 },
        sent: { threadsTotal: 0, threadsUnread: 0 },
      };
      return { success: true, counts: empty, connected: false, userDocMissing: true };
    }

    const userData: any = userDoc.data() || {};
    const cached = userData.gmailMailboxCounts;
    const cachedAt = userData.gmailMailboxCountsUpdatedAt;

    const cachedAtMs =
      cachedAt && typeof cachedAt.toMillis === 'function'
        ? cachedAt.toMillis()
        : cachedAt instanceof Date
          ? cachedAt.getTime()
          : typeof cachedAt === 'number'
            ? cachedAt
            : null;

    if (cached && cachedAtMs && Date.now() - cachedAtMs <= Number(maxAgeMs)) {
      return { success: true, counts: cached, cached: true };
    }

    const gmailTokens = userData?.gmailTokens;
    const emptyCounts = {
      inbox: { threadsTotal: 0, threadsUnread: 0, messagesUnread: 0 },
      primary: { threadsTotal: 0, threadsUnread: 0 },
      social: { threadsTotal: 0, threadsUnread: 0 },
      promotions: { threadsTotal: 0, threadsUnread: 0 },
      updates: { threadsTotal: 0, threadsUnread: 0 },
      forums: { threadsTotal: 0, threadsUnread: 0 },
      spam: { threadsTotal: 0, threadsUnread: 0 },
      starred: { threadsTotal: 0, threadsUnread: 0 },
      sent: { threadsTotal: 0, threadsUnread: 0 },
    };
    if (!gmailTokens?.access_token) {
      return { success: true, counts: emptyCounts, connected: false };
    }

    try {
      oauth2Client.setCredentials(gmailTokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      const fetchLabel = async (id: string) => {
        const res = await gmail.users.labels.get({ userId: 'me', id });
        return {
          threadsTotal: Number(res.data.threadsTotal || 0),
          threadsUnread: Number(res.data.threadsUnread || 0),
          messagesUnread: Number(res.data.messagesUnread || 0),
        };
      };

      // IMPORTANT:
      // Gmail category labels (CATEGORY_PROMOTIONS, etc.) can remain on messages even after archiving,
      // so `labels.get(...).threadsUnread` for those categories can drift from what Gmail/Mimestream show
      // inside the Inbox. To match Gmail/Mimestream "Inbox tab" semantics, we compute category unread as:
      //   UNREAD threads with labels: INBOX + CATEGORY_*
      const fetchUnreadThreadsInInboxForCategory = async (categoryLabelId: string) => {
        const res = await gmail.users.threads.list({
          userId: 'me',
          labelIds: ['INBOX', categoryLabelId],
          q: 'is:unread',
          maxResults: 1,
        });
        return Number((res.data as any)?.resultSizeEstimate || 0);
      };

      const fetchUnreadThreadsForLabel = async (labelId: string) => {
        const res = await gmail.users.threads.list({
          userId: 'me',
          labelIds: [labelId],
          q: 'is:unread',
          maxResults: 1,
          // For SPAM, Gmail treats it like a system mailbox, not Inbox.
          includeSpamTrash: labelId === 'SPAM' ? true : undefined,
        } as any);
        return Number((res.data as any)?.resultSizeEstimate || 0);
      };

      // Gmail system label IDs:
      // - INBOX
      // - CATEGORY_PERSONAL / SOCIAL / PROMOTIONS / UPDATES / FORUMS
      // - SPAM / STARRED / SENT
      const [inbox, spamLabel, starredLabel, sentLabel] = await Promise.all([
        fetchLabel('INBOX'),
        fetchLabel('SPAM'),
        fetchLabel('STARRED'),
        fetchLabel('SENT'),
      ]);

      const [
        primaryUnreadInInbox,
        socialUnreadInInbox,
        promotionsUnreadInInbox,
        updatesUnreadInInbox,
        forumsUnreadInInbox,
        spamUnread,
      ] = await Promise.all([
        fetchUnreadThreadsInInboxForCategory('CATEGORY_PERSONAL'),
        fetchUnreadThreadsInInboxForCategory('CATEGORY_SOCIAL'),
        fetchUnreadThreadsInInboxForCategory('CATEGORY_PROMOTIONS'),
        fetchUnreadThreadsInInboxForCategory('CATEGORY_UPDATES'),
        fetchUnreadThreadsInInboxForCategory('CATEGORY_FORUMS'),
        fetchUnreadThreadsForLabel('SPAM'),
      ]);

      const counts = {
        inbox: {
          threadsTotal: inbox.threadsTotal,
          threadsUnread: inbox.threadsUnread,
          messagesUnread: inbox.messagesUnread,
        },
        // Category counts = unread threads *within Inbox* (matches Gmail tab/Mimestream semantics)
        primary: { threadsTotal: 0, threadsUnread: primaryUnreadInInbox },
        social: { threadsTotal: 0, threadsUnread: socialUnreadInInbox },
        promotions: { threadsTotal: 0, threadsUnread: promotionsUnreadInInbox },
        updates: { threadsTotal: 0, threadsUnread: updatesUnreadInInbox },
        forums: { threadsTotal: 0, threadsUnread: forumsUnreadInInbox },
        // Spam is its own mailbox (not an Inbox tab)
        spam: { threadsTotal: spamLabel.threadsTotal, threadsUnread: spamUnread },
        // Not currently used for pills, but keep for completeness
        starred: { threadsTotal: starredLabel.threadsTotal, threadsUnread: starredLabel.threadsUnread },
        sent: { threadsTotal: sentLabel.threadsTotal, threadsUnread: sentLabel.threadsUnread },
      };

      await userRef.set(
        {
          gmailMailboxCounts: counts,
          gmailMailboxCountsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { success: true, counts, cached: false };
    } catch (err: any) {
      if (isGmailTokenError(err)) {
        logger.info('getGmailMailboxCounts: Gmail token expired or invalid, returning empty counts', { userId });
        return { success: true, counts: emptyCounts, connected: false };
      }
      if (isGmailRateLimitError(err)) {
        logger.warn('getGmailMailboxCounts: Gmail rate-limited; returning cached or empty counts', { userId });
        return {
          success: true,
          counts: cached || emptyCounts,
          connected: true,
          cached: !!cached,
          stale: !!cached,
          rateLimited: true,
        };
      }
      throw err;
    }
  }
);

/**
 * Fetch Gmail attachments (including inline CID images) for a specific Gmail message.
 * We persist them to Firebase Storage and return signed URLs for rendering/downloading.
 *
 * This is used by the email thread view to display inline images and attachments.
 */
export const getGmailMessageAttachments = onCall(
  { cors: true, memory: '512MiB', concurrency: 10, timeoutSeconds: 300 },
  async (request) => {
    try {
      const { userId, tenantId, gmailMessageId, threadId, maxAgeMs = 10 * 60 * 1000 } = request.data || {};
      if (!userId || !tenantId || !gmailMessageId) {
        logger.error('getGmailMessageAttachments: Missing required fields', { userId, tenantId, gmailMessageId });
        throw new HttpsError('invalid-argument', 'Missing required fields: userId, tenantId, gmailMessageId');
      }

      logger.info('getGmailMessageAttachments: Starting', { userId, tenantId, gmailMessageId, threadId });

      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        logger.error('getGmailMessageAttachments: User not found', { userId });
        throw new HttpsError('not-found', 'User not found');
      }

      const userData: any = userDoc.data() || {};
      const gmailTokens = userData?.gmailTokens;
      if (!gmailTokens?.access_token) {
        logger.warn('getGmailMessageAttachments: Gmail not connected', { userId });
        return { success: false, connected: false, attachments: [] };
      }

      oauth2Client.setCredentials(gmailTokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Load message payload to discover attachments + inline images
    const messageRes = await gmail.users.messages.get({
      userId: 'me',
      id: gmailMessageId,
      format: 'full',
    });
    const messageData = messageRes.data as any;
    const payload = messageData?.payload;

    const parts = collectAllParts(payload, []);

    type AttachmentOut = {
      id: string;
      name: string;
      contentType: string;
      size: number;
      storagePath: string;
      downloadUrl: string;
      contentId?: string;
      disposition?: 'inline' | 'attachment';
    };

    const bucket = getStorage().bucket(getStorageBucketName());
    const bucketName = bucket.name;
    const makeDownloadUrl = (path: string, token: string) =>
      `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
    const out: AttachmentOut[] = [];

    for (const part of parts) {
      const attachmentId = part?.body?.attachmentId;
      if (!attachmentId) continue;

      const mimeType = String(part?.mimeType || 'application/octet-stream');
      const filenameRaw = String(part?.filename || '');
      const filename = safeFilename(filenameRaw || `attachment-${attachmentId}`);
      const size = Number(part?.body?.size || 0);

      const headers = Array.isArray(part?.headers) ? part.headers : [];
      const contentIdRaw = headerValue(headers, 'Content-ID') || headerValue(headers, 'Content-Id');
      const contentId = contentIdRaw ? contentIdRaw.replace(/[<>]/g, '').trim() : undefined;
      const dispRaw = (headerValue(headers, 'Content-Disposition') || '').toLowerCase();
      const disposition: 'inline' | 'attachment' | undefined =
        dispRaw.startsWith('inline') ? 'inline' : dispRaw.startsWith('attachment') ? 'attachment' : undefined;

      const storagePath = `tenants/${tenantId}/gmailAttachments/${gmailMessageId}/${attachmentId}-${filename}`;
      const file = bucket.file(storagePath);

      // Cache: if file exists and is recent, reuse it (avoid re-downloading from Gmail)
      try {
        const [exists] = await file.exists();
        if (exists) {
          const [meta] = await file.getMetadata().catch(() => [null as any]);
          const updated = meta?.updated ? new Date(meta.updated).getTime() : null;
          const tokensRaw: string = String(meta?.metadata?.firebaseStorageDownloadTokens || '');
          const tokenFromMeta = tokensRaw.split(',')[0]?.trim();
          if (updated && Date.now() - updated <= Number(maxAgeMs)) {
            // Prefer Firebase download token URLs (avoid SignedUrl IAM/signBlob issues)
            let token = tokenFromMeta;
            if (!token) {
              try {
                // Node 20 supports crypto.randomUUID()
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const crypto = require('crypto');
                token = crypto.randomUUID();
                await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } }).catch(() => undefined);
              } catch (e: any) {
                logger.warn('getGmailMessageAttachments: Failed to set download token on cached attachment', {
                  gmailMessageId,
                  attachmentId,
                  error: e?.message,
                });
              }
            }
            const downloadUrl = token ? makeDownloadUrl(storagePath, token) : '';
            out.push({
              id: attachmentId,
              name: filenameRaw || filename,
              contentType: mimeType,
              size,
              storagePath,
              downloadUrl,
              contentId,
              disposition,
            });
            continue;
          }
        }
      } catch {
        // ignore cache errors; fall through to fetch
      }

      try {
        const attRes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: gmailMessageId,
          id: attachmentId,
        });

        const dataStr: string = String((attRes.data as any)?.data || '');
        if (!dataStr) {
          logger.warn('getGmailMessageAttachments: Empty attachment data', { attachmentId, gmailMessageId });
          continue;
        }

        const normalized = dataStr.replace(/-/g, '+').replace(/_/g, '/');
        let buffer: Buffer;
        try {
          buffer = Buffer.from(normalized, 'base64');
        } catch (err: any) {
          logger.error('getGmailMessageAttachments: Failed to decode base64', {
            attachmentId,
            gmailMessageId,
            error: err?.message,
          });
          continue;
        }

        if (buffer.length === 0) {
          logger.warn('getGmailMessageAttachments: Empty buffer after decode', { attachmentId, gmailMessageId });
          continue;
        }

        await file.save(buffer, {
          contentType: mimeType,
          resumable: false,
          metadata: {
            cacheControl: 'private, max-age=3600',
          },
        });
      } catch (partErr: any) {
        logger.error('getGmailMessageAttachments: Failed to fetch/save attachment', {
          attachmentId,
          gmailMessageId,
          error: partErr?.message,
          code: partErr?.code,
        });
        // Continue with other attachments even if one fails
        continue;
      }

      // Ensure a Firebase download token exists so we can build a stable URL (no signedUrl permissions required)
      let token = '';
      try {
        const [meta] = await file.getMetadata().catch(() => [null as any]);
        const tokensRaw: string = String(meta?.metadata?.firebaseStorageDownloadTokens || '');
        token = tokensRaw.split(',')[0]?.trim() || '';
      } catch {}
      if (!token) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const crypto = require('crypto');
          token = crypto.randomUUID();
          await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
        } catch (e: any) {
          logger.warn('getGmailMessageAttachments: Failed to set download token', {
            gmailMessageId,
            attachmentId,
            error: e?.message,
          });
        }
      }
      const downloadUrl = token ? makeDownloadUrl(storagePath, token) : '';

      out.push({
        id: attachmentId,
        name: filenameRaw || filename,
        contentType: mimeType,
        size,
        storagePath,
        downloadUrl,
        contentId,
        disposition,
      });
    }

    // Best-effort: persist onto our thread message doc so the UI can render without repeated calls
    if (threadId && out.length > 0) {
      try {
        const messagesSnap = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .doc(String(threadId))
          .collection('messages')
          .where('gmailMessageId', '==', gmailMessageId)
          .limit(1)
          .get();

        if (!messagesSnap.empty) {
          await messagesSnap.docs[0].ref.set(
            {
              attachments: out.map((a) => ({
                id: a.id,
                name: a.name,
                contentType: a.contentType,
                size: a.size,
                storagePath: a.storagePath,
                downloadUrl: a.downloadUrl,
                contentId: a.contentId,
                disposition: a.disposition,
              })),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (err: any) {
        logger.warn('Failed to persist Gmail attachments onto message doc', {
          tenantId,
          threadId,
          gmailMessageId,
          error: err?.message,
        });
      }
    }

      logger.info('getGmailMessageAttachments: Success', {
        userId,
        gmailMessageId,
        attachmentCount: out.length,
      });
      return { success: true, attachments: out };
    } catch (err: any) {
      logger.error('getGmailMessageAttachments: Error', {
        error: err?.message,
        stack: err?.stack,
        userId: request.data?.userId,
        gmailMessageId: request.data?.gmailMessageId,
      });
      // Preserve details client-side (avoid opaque functions/internal)
      throw err instanceof HttpsError
        ? err
        : new HttpsError('internal', `Failed to load Gmail attachments: ${err?.message || 'Unknown error'}`, {
            userId: request.data?.userId,
            tenantId: request.data?.tenantId,
            gmailMessageId: request.data?.gmailMessageId,
          });
    }
  }
);

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
    // Return a structured error instead of throwing to avoid 500s on the client
    const message = `Failed to test Gmail: ${error instanceof Error ? error.message : 'Unknown error'}`;
    return {
      success: false,
      message
    };
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

            // Create or find email thread and add message
            try {
              const thread = await findOrCreateEmailThread(tenantId, {
                subject,
                from,
                to: to.split(',').map(e => e.trim()).filter(Boolean),
                cc: cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
                gmailThreadId: messageData.threadId,
                gmailLabelIds: messageData.labelIds,
              }, {
                userId: !isOutbound ? userId : undefined,
              });

              if (thread.id) {
                await addMessageToThread(thread.id, tenantId, {
                  direction: isOutbound ? 'outbound' : 'inbound',
                  from,
                  fromUserId: isOutbound ? userId : undefined,
                  to: to.split(',').map(e => e.trim()).filter(Boolean),
                  cc: cc ? cc.split(',').map(e => e.trim()).filter(Boolean) : undefined,
                  subject,
                  bodyPlain: bodySnippet,
                  bodySnippet: bodySnippet.substring(0, 200),
                  status: 'delivered',
                  providerMessageId: message.id,
                  gmailMessageId: message.id,
                  read: isOutbound, // Outbound messages are auto-read
                  createdAt: emailDate, // Use the original email timestamp
                });
              }
            } catch (threadError) {
              // Don't fail sync if threading fails
              logger.error(`Failed to create email thread: ${threadError}`);
            }

            // Also log to unified messageLogs for inbox visibility (only for inbound emails to the logged-in user)
            if (!isOutbound) {
              // Inbound email: logged-in user received it
              try {
                await logMessage({
                  userId: userId, // The user who received the email
                  tenantId,
                  messageTypeId: 'inbound_message',
                  channel: 'email',
                  direction: 'inbound',
                  fromIdentity: 'candidate', // Could be 'recruiter' or 'candidate' - defaulting to candidate
                  contentOriginal: bodySnippet, // Use bodySnippet since bodyHtml isn't extracted in this function
                  contentSent: bodySnippet.substring(0, 500), // Truncate for display
                  language: null, // Could extract from email headers if needed
                  status: 'delivered',
                  providerMessageId: message.id,
                });
              } catch (logError) {
                // Don't fail sync if logging fails
                logger.error(`Failed to log inbound email to messageLogs: ${logError}`);
              }
            }

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
              await logger.aiEvent({
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
// CHANGE: Hardening per cost-control policy
// - Env kill-switch; caps for scheduler
const ENABLE_GMAIL_MONITORING = process.env.ENABLE_GMAIL_MONITORING === 'true';
export const scheduledGmailMonitoring = onSchedule({
  // Run every 60 minutes to reduce function call frequency
  schedule: 'every 2 hours',
  timeZone: 'America/New_York',
  maxInstances: 1,
  retryCount: 0,
  timeoutSeconds: 240,
  memory: '256MiB'
}, async (context) => {
  if (!ENABLE_GMAIL_MONITORING) {
    console.info('scheduledGmailMonitoring: disabled by ENABLE_GMAIL_MONITORING');
    return;
  }
  
  // Idempotency: process this run only once
  const runId = `gmail_monitoring_${new Date().toISOString().split('T')[0]}`;
  const db = admin.firestore();
  const runRef = db.collection('function_runs').doc(runId);
  
  try {
    await runRef.create({ createdAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch {
    console.info('scheduledGmailMonitoring: already processed today, skipping');
    return;
  }
  
  const started = Date.now();
  const timeBudget = 45000; // 45 seconds max
  let tenantsProcessed = 0;
  let pagesProcessed = 0;
  let newItems = 0;
  
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
  } finally {
    console.log(JSON.stringify({ event: 'job_summary', job: 'scheduledGmailMonitoring', duration_ms: Date.now() - started, success: true }));
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