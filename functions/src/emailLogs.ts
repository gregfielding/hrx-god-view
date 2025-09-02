import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';

const db = getFirestore();
const auth = getAuth();

// Google OAuth configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

/**
 * Fetch and cache full email body for an email_logs document.
 * Input: { tenantId: string, emailLogId: string }
 * Returns: { bodyHtml?: string, bodySnippet?: string }
 */
export const getEmailLogBody = onCall({ 
  cors: true, 
  timeoutSeconds: 60, 
  memory: '256MiB',
  maxInstances: 2 // Added for cost containment
}, async (request) => {
  const { tenantId, emailLogId } = request.data || {};
  if (!tenantId || !emailLogId) {
    throw new Error('tenantId and emailLogId are required');
  }

  const emailRef = db.collection('tenants').doc(tenantId).collection('email_logs').doc(emailLogId);
  const emailDoc = await emailRef.get();
  if (!emailDoc.exists) {
    throw new Error('Email log not found');
  }

  const emailData = emailDoc.data() as any;
  // If already cached, return immediately
  if (emailData?.bodyHtml || emailData?.bodySnippet) {
    return { bodyHtml: emailData.bodyHtml, bodySnippet: emailData.bodySnippet };
  }

  const messageId: string = emailData.gmailMessageId || emailData.messageId;
  const userId: string = emailData.userId;
  if (!messageId || !userId) {
    throw new Error('Missing gmailMessageId/messageId or userId on email log');
  }

  // Load user tokens
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) {
    throw new Error('User not found for email log');
  }
  const user = userSnap.data() as any;
  if (!user?.gmailTokens) {
    throw new Error('User has no Gmail tokens');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId.value(),
    clientSecret.value(),
    redirectUri.value()
  );
  oauth2Client.setCredentials(user.gmailTokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Fetch full message to extract HTML/text
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const payload = msg.data.payload;
  let bodyHtml = '';
  let bodySnippet = msg.data.snippet || '';

  function traverseParts(parts?: any[]): void {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        try {
          bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } catch {}
      } else if (part.mimeType === 'text/plain' && part.body?.data && !bodySnippet) {
        try {
          bodySnippet = Buffer.from(part.body.data, 'base64').toString('utf-8').slice(0, 500);
        } catch {}
      }
      if (part.parts) traverseParts(part.parts);
    }
  }

  if (payload?.body?.data) {
    try {
      bodyHtml = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } catch {}
  }
  if (!bodyHtml && payload?.parts) {
    traverseParts(payload.parts);
  }

  await emailRef.update({
    bodyHtml: bodyHtml || null,
    bodySnippet: bodySnippet || null,
    updatedAt: new Date(),
  });

  return { bodyHtml, bodySnippet };
});


