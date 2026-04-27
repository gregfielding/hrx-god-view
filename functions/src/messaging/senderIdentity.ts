/**
 * Sender Identity Resolution
 * 
 * Resolves which sender identity to use for a message based on metadata and user configuration.
 * Supports system sender, recruiter Gmail, and recruiter SMS numbers.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export interface SenderIdentity {
  id: string;
  type: 'system' | 'gmail' | 'recruiter_sms';
  emailProvider?: 'sendgrid' | 'gmail';
  emailAddress?: string;
  gmailUserId?: string; // User ID whose Gmail tokens to use
  smsProvider?: 'twilio';
  twilioNumber?: string; // E.164 format
  twilioNumberSid?: string;
  enabled: boolean;
}

/**
 * Resolve sender identity from message context
 */
export async function resolveSenderIdentity(
  tenantId: string,
  context: { metadata?: Record<string, any>; source?: string; sourceId?: string }
): Promise<SenderIdentity> {
  // 1. Check for explicit sender in metadata
  if (context.metadata?.senderId) {
    const sender = await getSenderIdentity(tenantId, context.metadata.senderId, context.metadata.senderType);
    if (sender && sender.enabled) {
      return sender;
    }
    logger.warn(`Requested sender ${context.metadata.senderId} not found or disabled, falling back to system`);
  }
  
  // 2. Check for recruiter sender (from source/sourceId)
  if (context.source === 'recruiter' && context.sourceId) {
    const recruiterSender = await getRecruiterSenderIdentity(tenantId, context.sourceId);
    if (recruiterSender && recruiterSender.enabled) {
      return recruiterSender;
    }
  }
  
  // 3. Fallback to system sender
  return getSystemSenderIdentity(tenantId);
}

/**
 * Get system sender identity (SendGrid + main Twilio number)
 */
export async function getSystemSenderIdentity(tenantId: string): Promise<SenderIdentity> {
  // System sender is always available
  return {
    id: 'system',
    type: 'system',
    emailProvider: 'sendgrid',
    smsProvider: 'twilio',
    enabled: true,
  };
}

/**
 * Get recruiter sender identity (Gmail + recruiter number if available)
 */
async function getRecruiterSenderIdentity(
  tenantId: string,
  recruiterId: string
): Promise<SenderIdentity | null> {
  try {
    // Check for recruiter number assignment
    const recruiterNumberDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('recruiterNumbers')
      .doc(recruiterId)
      .get();
    
    const recruiterNumber = recruiterNumberDoc.exists ? recruiterNumberDoc.data() : null;
    
    // Check for Gmail connection
    const userDoc = await db.collection('users').doc(recruiterId).get();
    const userData = userDoc.exists ? userDoc.data() : null;
    const hasGmail = !!(userData?.gmailConnected && userData?.gmailTokens?.access_token);
    const gmailEmail = userData?.gmailTokens?.email || userData?.email;
    
    // Build sender identity
    const sender: SenderIdentity = {
      id: `recruiter_${recruiterId}`,
      type: hasGmail ? 'gmail' : 'system', // Prefer Gmail if available
      enabled: true,
    };
    
    if (hasGmail && gmailEmail) {
      sender.emailProvider = 'gmail';
      sender.emailAddress = gmailEmail;
      sender.gmailUserId = recruiterId;
    } else {
      sender.emailProvider = 'sendgrid';
    }
    
    if (recruiterNumber?.twilioNumber && !recruiterNumber.useMainNumber) {
      sender.smsProvider = 'twilio';
      sender.twilioNumber = recruiterNumber.twilioNumber;
      sender.twilioNumberSid = recruiterNumber.twilioNumberSid;
      sender.type = sender.type === 'gmail' ? 'gmail' : 'recruiter_sms';
    } else {
      sender.smsProvider = 'twilio';
    }
    
    return sender;
  } catch (error: any) {
    logger.error(`Error getting recruiter sender identity for ${recruiterId}:`, error);
    return null;
  }
}

/**
 * Get specific sender identity by ID and type
 */
async function getSenderIdentity(
  tenantId: string,
  senderId: string,
  senderType?: string
): Promise<SenderIdentity | null> {
  if (senderId === 'system') {
    return getSystemSenderIdentity(tenantId);
  }
  
  if (senderId === 'gmail' || senderType === 'gmail') {
    // This would need the recruiterId from context, but for now we'll handle it in resolveSenderIdentity
    return null; // Will be handled by getRecruiterSenderIdentity
  }
  
  if (senderId === 'recruiter_sms' || senderType === 'recruiter_sms') {
    // This would need the recruiterId from context
    return null; // Will be handled by getRecruiterSenderIdentity
  }
  
  // Try to parse recruiter ID from senderId
  if (senderId.startsWith('recruiter_')) {
    const recruiterId = senderId.replace('recruiter_', '');
    return getRecruiterSenderIdentity(tenantId, recruiterId);
  }
  
  return null;
}

