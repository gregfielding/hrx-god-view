/**
 * STOP / HELP Keyword Handling
 * 
 * Handles inbound SMS keywords for compliance and user support.
 * Implements carrier-required STOP/HELP functionality.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 6.2
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { logPreferenceChange } from './messageLogging';
import { sendWorkerMessageInternal } from '../twilio';
import { updateTenantSmsConsent } from './tenantConsent';

const db = admin.firestore();

/**
 * STOP keywords that trigger opt-out
 * Following Twilio best practices and carrier requirements
 */
export const STOP_KEYWORDS = [
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPT OUT',
  'OPTOUT',
];

/**
 * HELP keywords that trigger support message
 */
export const HELP_KEYWORDS = [
  'HELP',
  'INFO',
  'SUPPORT',
];

/**
 * RE-OPT-IN keywords (if user wants to re-enable after STOP)
 */
export const START_KEYWORDS = [
  'START',
  'YES',
  'UNSTOP',
  'SUBSCRIBE',
];

/**
 * Normalize message body for keyword matching
 */
function normalizeMessageBody(body: string): string {
  return body.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Check if message matches any keyword in list
 */
function matchesKeyword(normalizedBody: string, keywords: string[]): boolean {
  const normalizedKeywords = keywords.map(k => k.toUpperCase());
  return normalizedKeywords.some(keyword => normalizedBody === keyword || normalizedBody.startsWith(keyword + ' '));
}

/**
 * Handle STOP keyword - opt user out of SMS
 */
export async function handleStopKeyword(
  phoneE164: string,
  messageBody: string,
  twilioMessageSid?: string
): Promise<{ success: boolean; messageSent: boolean; error?: string }> {
  try {
    logger.info(`Handling STOP keyword from ${phoneE164}`);
    
    // Find user by phone number
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', phoneE164)
      .limit(1)
      .get();
    
    if (usersQuery.empty) {
      logger.warn(`STOP keyword from unknown phone ${phoneE164}`);
      // Still send confirmation even if user not found
      await sendStopConfirmation(phoneE164);
      return { success: true, messageSent: true };
    }
    
    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    // Check current state
    const currentSmsOptIn = userData?.smsOptIn !== false;
    const currentSmsBlocked = userData?.smsBlockedSystem === true;
    
    // If already blocked, just send confirmation
    if (currentSmsBlocked) {
      logger.info(`User ${userId} already blocked, sending confirmation`);
      await sendStopConfirmation(phoneE164);
      return { success: true, messageSent: true };
    }
    
    // PHASE 4: Get tenantId (required for tenant-scoped consent)
    const tenantId = userData.tenantId || 'unknown';
    
    // PHASE 4: Update tenant-scoped SMS consent (authoritative source)
    await updateTenantSmsConsent(
      tenantId,
      userId,
      {
        phoneNumber: phoneE164,
        smsOptIn: false,
        smsBlockedSystem: true,
        source: 'keyword',
      },
      {
        type: 'STOP',
        source: 'keyword',
        previousValue: {
          smsOptIn: currentSmsOptIn,
          smsBlockedSystem: currentSmsBlocked,
        },
        newValue: {
          smsOptIn: false,
          smsBlockedSystem: true,
        },
        rawMessageSid: twilioMessageSid,
        rawPayload: { messageBody },
      }
    );
    
    // Also update user document for backward compatibility (mirroring happens in updateTenantSmsConsent)
    // But we still need to update smsConsent structure
    const updates: any = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Update SMS consent record (legacy structure)
    if (!userData.smsConsent) {
      userData.smsConsent = {};
    }
    
    updates.smsConsent = {
      agreed: false,
      version: '2025-01-27', // Update with current consent version
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: 'keyword',
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await userDoc.ref.update(updates);
    
    // Log preference change (centralized logging)
    await logPreferenceChange({
      userId,
      tenantId,
      preferenceType: 'smsOptIn',
      oldValue: currentSmsOptIn,
      newValue: false,
      source: 'keyword',
      reason: 'User sent STOP keyword',
    });
    
    await logPreferenceChange({
      userId,
      tenantId,
      preferenceType: 'smsBlockedSystem',
      oldValue: currentSmsBlocked,
      newValue: true,
      source: 'keyword',
      reason: 'User sent STOP keyword',
    });
    
    // Send STOP confirmation
    await sendStopConfirmation(phoneE164);
    
    // Log STOP event to userConsents/{uid}/events (compliance requirement)
    try {
      const consentEventsRef = db.collection('userConsents').doc(userId).collection('events');
      await consentEventsRef.add({
        type: 'STOP',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source: 'sms',
        twilioSid: twilioMessageSid || null,
      });
      logger.info(`Logged STOP event to userConsents for user ${userId}`);
    } catch (consentError: any) {
      logger.error(`Error logging STOP event to userConsents:`, consentError);
      // Don't throw - logging failure shouldn't break STOP processing
    }
    
    // Log inbound message
    await logInboundMessage(phoneE164, userId, messageBody, 'stop', twilioMessageSid);
    
    // Notify any active recruiter threads (if thread system exists)
    await notifyRecruitersOfOptOut(userId, userData.tenantId);
    
    logger.info(`User ${userId} opted out via STOP keyword`);
    
    return { success: true, messageSent: true };
  } catch (error: any) {
    logger.error(`Error handling STOP keyword for ${phoneE164}:`, error);
    return { success: false, messageSent: false, error: error.message };
  }
}

/**
 * Handle HELP keyword - send support information
 */
export async function handleHelpKeyword(
  phoneE164: string,
  messageBody: string,
  twilioMessageSid?: string
): Promise<{ success: boolean; messageSent: boolean; error?: string }> {
  try {
    logger.info(`Handling HELP keyword from ${phoneE164}`);
    
    // Find user by phone number
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', phoneE164)
      .limit(1)
      .get();
    
    let tenantId = 'unknown';
    let userId: string | null = null;
    
    if (!usersQuery.empty) {
      const userDoc = usersQuery.docs[0];
      userId = userDoc.id;
      tenantId = userDoc.data()?.tenantId || 'unknown';
    }
    
    // Send HELP message
    await sendHelpMessage(phoneE164, tenantId);
    
    // Log HELP event to userConsents/{uid}/events (compliance requirement)
    if (userId) {
      try {
        const consentEventsRef = db.collection('userConsents').doc(userId).collection('events');
        await consentEventsRef.add({
          type: 'HELP',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          source: 'sms',
          twilioSid: twilioMessageSid || null,
        });
        logger.info(`Logged HELP event to userConsents for user ${userId}`);
      } catch (consentError: any) {
        logger.error(`Error logging HELP event to userConsents:`, consentError);
        // Don't throw - logging failure shouldn't break HELP processing
      }
      
      // Log inbound message
      await logInboundMessage(phoneE164, userId, messageBody, 'help', twilioMessageSid);
    }
    
    return { success: true, messageSent: true };
  } catch (error: any) {
    logger.error(`Error handling HELP keyword for ${phoneE164}:`, error);
    return { success: false, messageSent: false, error: error.message };
  }
}

/**
 * Handle START keyword - re-opt-in user
 */
export async function handleStartKeyword(
  phoneE164: string,
  messageBody: string,
  twilioMessageSid?: string
): Promise<{ success: boolean; messageSent: boolean; error?: string }> {
  try {
    logger.info(`Handling START keyword from ${phoneE164}`);
    
    // Find user by phone number
    const usersQuery = await db.collection('users')
      .where('phoneE164', '==', phoneE164)
      .limit(1)
      .get();
    
    if (usersQuery.empty) {
      logger.warn(`START keyword from unknown phone ${phoneE164}`);
      await sendStartConfirmation(phoneE164);
      return { success: true, messageSent: true };
    }
    
    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    // Check current state
    const currentSmsOptIn = userData?.smsOptIn !== false;
    const currentSmsBlocked = userData?.smsBlockedSystem === true;
    
    // If already opted in, just send confirmation
    if (currentSmsOptIn && !currentSmsBlocked) {
      logger.info(`User ${userId} already opted in, sending confirmation`);
      await sendStartConfirmation(phoneE164);
      return { success: true, messageSent: true };
    }
    
    // PHASE 4: Get tenantId (required for tenant-scoped consent)
    const tenantId = userData.tenantId || 'unknown';
    
    // PHASE 4: Update tenant-scoped SMS consent (authoritative source)
    await updateTenantSmsConsent(
      tenantId,
      userId,
      {
        phoneNumber: phoneE164,
        smsOptIn: true,
        smsBlockedSystem: false,
        source: 'keyword',
      },
      {
        type: 'START',
        source: 'keyword',
        previousValue: {
          smsOptIn: currentSmsOptIn,
          smsBlockedSystem: currentSmsBlocked,
        },
        newValue: {
          smsOptIn: true,
          smsBlockedSystem: false,
        },
        rawMessageSid: twilioMessageSid,
        rawPayload: { messageBody },
      }
    );
    
    // Also update user document for backward compatibility (mirroring happens in updateTenantSmsConsent)
    // But we still need to update smsConsent structure
    const updates: any = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Update SMS consent record (legacy structure)
    if (!userData.smsConsent) {
      userData.smsConsent = {};
    }
    
    updates.smsConsent = {
      agreed: true,
      version: '2025-01-27', // Update with current consent version
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: 'keyword',
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await userDoc.ref.update(updates);
    
    // Log preference change (centralized logging)
    await logPreferenceChange({
      userId,
      tenantId,
      preferenceType: 'smsOptIn',
      oldValue: currentSmsOptIn,
      newValue: true,
      source: 'keyword',
      reason: 'User sent START keyword',
    });
    
    await logPreferenceChange({
      userId,
      tenantId,
      preferenceType: 'smsBlockedSystem',
      oldValue: currentSmsBlocked,
      newValue: false,
      source: 'keyword',
      reason: 'User sent START keyword',
    });
    
    // Send START confirmation
    await sendStartConfirmation(phoneE164);
    
    // Log inbound message
    await logInboundMessage(phoneE164, userId, messageBody, 'start', twilioMessageSid);
    
    logger.info(`User ${userId} re-opted in via START keyword`);
    
    return { success: true, messageSent: true };
  } catch (error: any) {
    logger.error(`Error handling START keyword for ${phoneE164}:`, error);
    return { success: false, messageSent: false, error: error.message };
  }
}

/**
 * Process inbound SMS message and handle keywords
 */
export async function processInboundSms(
  phoneE164: string,
  messageBody: string,
  twilioMessageSid?: string,
  fromNumber?: string
): Promise<{ handled: boolean; keyword?: string; result?: any }> {
  try {
    const normalizedBody = normalizeMessageBody(messageBody);
    
    // Check for STOP keywords
    if (matchesKeyword(normalizedBody, STOP_KEYWORDS)) {
      const result = await handleStopKeyword(phoneE164, messageBody, twilioMessageSid);
      return { handled: true, keyword: 'STOP', result };
    }
    
    // Check for HELP keywords
    if (matchesKeyword(normalizedBody, HELP_KEYWORDS)) {
      const result = await handleHelpKeyword(phoneE164, messageBody, twilioMessageSid);
      return { handled: true, keyword: 'HELP', result };
    }
    
    // Check for START keywords
    if (matchesKeyword(normalizedBody, START_KEYWORDS)) {
      const result = await handleStartKeyword(phoneE164, messageBody, twilioMessageSid);
      return { handled: true, keyword: 'START', result };
    }
    
    // Not a keyword - return unhandled
    return { handled: false };
  } catch (error: any) {
    logger.error(`Error processing inbound SMS from ${phoneE164}:`, error);
    return { handled: false };
  }
}

/**
 * Send STOP confirmation message
 */
async function sendStopConfirmation(phoneE164: string): Promise<void> {
  const message = 'You have been unsubscribed from SMS messages. You will no longer receive text messages from us. Reply START to opt back in.';
  
  try {
    await sendWorkerMessageInternal(phoneE164, message, {
      systemContext: true,
      source: 'stop_confirmation',
    });
  } catch (error: any) {
    logger.error(`Error sending STOP confirmation to ${phoneE164}:`, error);
    // Don't throw - confirmation failure shouldn't break STOP processing
  }
}

/**
 * Send HELP message
 * Must match spec exactly: "Reply STOP to cancel. Message & data rates may apply. Email support@c1staffing.com for help."
 */
async function sendHelpMessage(phoneE164: string, tenantId: string): Promise<void> {
  // Spec requires exact text:
  const message = 'Reply STOP to cancel. Message & data rates may apply. Email support@c1staffing.com for help.';
  
  try {
    await sendWorkerMessageInternal(phoneE164, message, {
      systemContext: true,
      source: 'help_response',
    });
  } catch (error: any) {
    logger.error(`Error sending HELP message to ${phoneE164}:`, error);
    // Don't throw - HELP failure shouldn't break processing
  }
}

/**
 * Send START confirmation message
 */
async function sendStartConfirmation(phoneE164: string): Promise<void> {
  const message = 'You have been re-subscribed to SMS messages. You will now receive text messages from us. Reply STOP to unsubscribe.';
  
  try {
    await sendWorkerMessageInternal(phoneE164, message, {
      systemContext: true,
      source: 'start_confirmation',
    });
  } catch (error: any) {
    logger.error(`Error sending START confirmation to ${phoneE164}:`, error);
    // Don't throw - confirmation failure shouldn't break START processing
  }
}

/**
 * Log inbound message
 */
async function logInboundMessage(
  phoneE164: string,
  userId: string,
  messageBody: string,
  keywordType: 'stop' | 'help' | 'start' | 'other',
  twilioMessageSid?: string
): Promise<void> {
  try {
    const { logMessage } = await import('./messageLogging');
    
    // Get tenant ID
    const userDoc = await db.doc(`users/${userId}`).get();
    const userData = userDoc.data();
    const tenantId = userData?.tenantId || 'unknown';
    
    await logMessage({
      userId,
      tenantId,
      messageTypeId: `inbound_${keywordType}`,
      channel: 'sms',
      direction: 'inbound',
      fromIdentity: 'candidate',
      contentSent: messageBody,
      language: 'en',
      status: 'delivered',
      providerMessageId: twilioMessageSid,
    });
  } catch (error: any) {
    logger.error(`Error logging inbound message:`, error);
    // Don't throw - logging failure shouldn't break processing
  }
}

/**
 * Notify recruiters of user opt-out
 */
async function notifyRecruitersOfOptOut(userId: string, tenantId?: string): Promise<void> {
  try {
    // This will be enhanced when two-way messaging is implemented
    // For now, just log the opt-out event
    
    // Could create a notification for recruiters who have active conversations
    // with this user, but that requires thread/conversation system
    
    logger.info(`User ${userId} opted out - recruiters should be notified if active threads exist`);
  } catch (error: any) {
    logger.error(`Error notifying recruiters of opt-out:`, error);
    // Don't throw - notification failure shouldn't break STOP processing
  }
}

