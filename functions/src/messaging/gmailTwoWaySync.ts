/**
 * Gmail Two-Way Sync Service
 * 
 * Syncs read state, archive/delete actions between HRX and Gmail.
 */

import { logger } from 'firebase-functions/v2';
import { google } from 'googleapis';
import { defineString } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { getEmailProvider } from './emailProviderFactory';

const db = admin.firestore();

// Google OAuth2 configuration
const clientId = defineString('GOOGLE_CLIENT_ID');
const clientSecret = defineString('GOOGLE_CLIENT_SECRET');
const redirectUri = defineString('GOOGLE_REDIRECT_URI');

/**
 * Sync read state to Gmail
 * Marks a Gmail message as read when it's read in HRX
 */
export async function syncReadStateToGmail(
  userId: string,
  gmailMessageId: string,
  read: boolean
): Promise<void> {
  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      logger.warn(`Gmail not connected for user ${userId}`);
      return; // Not an error - user may not have Gmail connected
    }

    // Refresh token if needed
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );

    oauth2Client.setCredentials(gmailTokens);

    // Check if token is expired
    const expiryDate = gmailTokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      logger.info(`Refreshing Gmail token for user ${userId}`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update tokens in Firestore
      await db.collection('users').doc(userId).update({
        'gmailTokens.access_token': credentials.access_token,
        'gmailTokens.expiry_date': credentials.expiry_date,
        'gmailTokens.token_type': credentials.token_type,
      });
      
      oauth2Client.setCredentials(credentials);
    }

    // Get Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Modify message labels (add/remove UNREAD label)
    if (read) {
      // Mark as read (remove UNREAD label)
      await gmail.users.messages.modify({
        userId: 'me',
        id: gmailMessageId,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
      logger.info(`Marked Gmail message ${gmailMessageId} as read`);
    } else {
      // Mark as unread (add UNREAD label)
      await gmail.users.messages.modify({
        userId: 'me',
        id: gmailMessageId,
        requestBody: {
          addLabelIds: ['UNREAD'],
        },
      });
      logger.info(`Marked Gmail message ${gmailMessageId} as unread`);
    }
  } catch (error: any) {
    // Don't throw - this is a best-effort sync
    logger.error(`Failed to sync read state to Gmail for message ${gmailMessageId}:`, error);
  }
}

/**
 * Sync read state to Gmail at the thread level.
 * This matches Gmail UI behavior: marking a conversation read clears UNREAD across the thread.
 */
export async function syncThreadReadStateToGmail(
  userId: string,
  gmailThreadId: string,
  read: boolean
): Promise<void> {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;
    if (!gmailTokens?.access_token) {
      logger.warn(`Gmail not connected for user ${userId}`);
      return;
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );
    oauth2Client.setCredentials(gmailTokens);

    const expiryDate = gmailTokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      logger.info(`Refreshing Gmail token for user ${userId}`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      await db.collection('users').doc(userId).update({
        'gmailTokens.access_token': credentials.access_token,
        'gmailTokens.expiry_date': credentials.expiry_date,
        'gmailTokens.token_type': credentials.token_type,
      });
      oauth2Client.setCredentials(credentials);
    }

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    await gmail.users.threads.modify({
      userId: 'me',
      id: gmailThreadId,
      requestBody: read
        ? { removeLabelIds: ['UNREAD'] }
        : { addLabelIds: ['UNREAD'] },
    });

    logger.info(
      `${read ? 'Marked' : 'Marked'} Gmail thread ${gmailThreadId} as ${read ? 'read' : 'unread'}`
    );
  } catch (error: any) {
    logger.error(`Failed to sync thread read state to Gmail for thread ${gmailThreadId}:`, error);
  }
}

/**
 * Sync archive state to Gmail
 * Archives/unarchives a Gmail thread when archived in HRX
 */
export async function syncArchiveStateToGmail(
  userId: string,
  gmailThreadId: string,
  archived: boolean
): Promise<void> {
  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      logger.warn(`Gmail not connected for user ${userId}`);
      return; // Not an error - user may not have Gmail connected
    }

    // Refresh token if needed
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );

    oauth2Client.setCredentials(gmailTokens);

    // Check if token is expired
    const expiryDate = gmailTokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      logger.info(`Refreshing Gmail token for user ${userId}`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update tokens in Firestore
      await db.collection('users').doc(userId).update({
        'gmailTokens.access_token': credentials.access_token,
        'gmailTokens.expiry_date': credentials.expiry_date,
        'gmailTokens.token_type': credentials.token_type,
      });
      
      oauth2Client.setCredentials(credentials);
    }

    // Get Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Modify thread labels (add/remove INBOX label)
    if (archived) {
      // Archive (remove from INBOX)
      await gmail.users.threads.modify({
        userId: 'me',
        id: gmailThreadId,
        requestBody: {
          removeLabelIds: ['INBOX'],
        },
      });
      logger.info(`Archived Gmail thread ${gmailThreadId}`);
    } else {
      // Unarchive (add to INBOX)
      await gmail.users.threads.modify({
        userId: 'me',
        id: gmailThreadId,
        requestBody: {
          addLabelIds: ['INBOX'],
        },
      });
      logger.info(`Unarchived Gmail thread ${gmailThreadId}`);
    }
  } catch (error: any) {
    // Don't throw - this is a best-effort sync
    logger.error(`Failed to sync archive state to Gmail for thread ${gmailThreadId}:`, error);
  }
}

/**
 * Sync delete state to Gmail
 * Moves a Gmail thread to trash when deleted in HRX
 */
export async function syncDeleteStateToGmail(
  userId: string,
  gmailThreadId: string
): Promise<void> {
  try {
    // Get user's Gmail tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw new Error('User not found');
    }

    const userData = userDoc.data();
    const gmailTokens = userData?.gmailTokens;

    if (!gmailTokens?.access_token) {
      logger.warn(`Gmail not connected for user ${userId}`);
      return; // Not an error - user may not have Gmail connected
    }

    // Refresh token if needed
    const oauth2Client = new google.auth.OAuth2(
      clientId.value(),
      clientSecret.value(),
      redirectUri.value()
    );

    oauth2Client.setCredentials(gmailTokens);

    // Check if token is expired
    const expiryDate = gmailTokens.expiry_date;
    if (expiryDate && Date.now() >= expiryDate - 5 * 60 * 1000) {
      logger.info(`Refreshing Gmail token for user ${userId}`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update tokens in Firestore
      await db.collection('users').doc(userId).update({
        'gmailTokens.access_token': credentials.access_token,
        'gmailTokens.expiry_date': credentials.expiry_date,
        'gmailTokens.token_type': credentials.token_type,
      });
      
      oauth2Client.setCredentials(credentials);
    }

    // Get Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Trash the thread
    await gmail.users.threads.trash({
      userId: 'me',
      id: gmailThreadId,
    });
    
    logger.info(`Trashed Gmail thread ${gmailThreadId}`);
  } catch (error: any) {
    // Don't throw - this is a best-effort sync
    logger.error(`Failed to sync delete state to Gmail for thread ${gmailThreadId}:`, error);
  }
}

