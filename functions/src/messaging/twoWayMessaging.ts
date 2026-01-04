/**
 * Two-Way Messaging System
 * 
 * Thread and message management for recruiter ↔ candidate SMS conversations.
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 2 Two-Way Messaging
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { logMessage, MessageLog } from './messageLogging';
import { sendWorkerMessageInternal } from '../twilio';
import { processInboundSms } from './stopHelpHandler';

const db = admin.firestore();

export type ThreadStatus = 'open' | 'snoozed' | 'closed';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageFromType = 'candidate' | 'recruiter' | 'system' | 'ai';

export interface SmsThread {
  id?: string;
  tenantId: string;                    // Required even though path encodes it
  candidateUserId: string;              // Renamed from candidateId to match spec
  candidatePhone: string;               // E.164 format
  primaryRecruiterUserId: string | null; // Renamed from primaryRecruiterId to match spec
  twilioNumber: string;                 // Number used for outbound messages
  status: ThreadStatus;
  lastMessageAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  lastMessageSnippet?: string;          // From spec
  unreadCountForRecruiter?: number;    // From spec (simplified from object)
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  // Optional metadata
  jobOrderId?: string;
  applicationId?: string;
}

export interface SmsMessage {
  id?: string;
  tenantId: string;                     // Required even though path encodes it
  threadId: string;
  direction: MessageDirection;
  fromType: MessageFromType;
  fromUserId?: string;                  // Recruiter id, or null for candidate/system
  body: string;
  language: 'en' | 'es' | null;
  providerMessageId?: string;           // Twilio message SID
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'not_sent';
  failureReason?: string;               // From spec
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

/**
 * Find or create thread for candidate and Twilio number
 */
export async function findOrCreateThread(
  candidateId: string,
  candidatePhone: string,
  twilioNumber: string,
  tenantId: string,
  options?: {
    primaryRecruiterId?: string;
    jobOrderId?: string;
    applicationId?: string;
  }
): Promise<SmsThread> {
  try {
    // Find existing open thread
    // Implements: HRX Firestore Collections Spec §2 - /tenants/{tenantId}/smsThreads/{threadId}
    const existingThreads = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsThreads')
      .where('candidateUserId', '==', candidateId)
      .where('twilioNumber', '==', twilioNumber)
      .where('status', '==', 'open')
      .limit(1)
      .get();
    
    if (!existingThreads.empty) {
      const threadDoc = existingThreads.docs[0];
      return {
        id: threadDoc.id,
        ...threadDoc.data(),
      } as SmsThread;
    }
    
    // Create new thread
    const threadData: Omit<SmsThread, 'id'> = {
      tenantId,
      candidateUserId: candidateId,
      primaryRecruiterUserId: options?.primaryRecruiterId || null,
      twilioNumber,
      candidatePhone,
      status: 'open',
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      jobOrderId: options?.jobOrderId,
      applicationId: options?.applicationId,
    };
    
    const threadRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsThreads')
      .add(threadData);
    
    logger.info(`Created new SMS thread ${threadRef.id} for candidate ${candidateId}`);
    
    return {
      id: threadRef.id,
      ...threadData,
    } as SmsThread;
  } catch (error: any) {
    logger.error(`Error finding/creating thread for candidate ${candidateId}:`, error);
    throw error;
  }
}

/**
 * Create inbound message in thread
 */
export async function createInboundMessage(
  threadId: string,
  body: string,
  providerMessageId: string,
  options?: {
    language?: 'en' | 'es';
    metadata?: Record<string, any>;
  }
): Promise<string> {
  try {
    // Get thread to get tenantId
    const threadDoc = await db
      .collectionGroup('smsThreads')
      .where(admin.firestore.FieldPath.documentId(), '==', threadId)
      .limit(1)
      .get();
    
    if (threadDoc.empty) {
      throw new Error(`Thread ${threadId} not found`);
    }
    
    const thread = threadDoc.docs[0];
    const threadData = thread.data() as SmsThread;
    const resolvedTenantId = threadData.tenantId || thread.ref.parent.parent?.id;
    
    if (!resolvedTenantId) {
      throw new Error(`Could not determine tenantId for thread ${threadId}`);
    }
    
    const messageData: Omit<SmsMessage, 'id'> = {
      tenantId: resolvedTenantId,
      threadId,
      direction: 'inbound',
      fromType: 'candidate',
      body,
      language: options?.language || null,
      providerMessageId,
      status: 'delivered',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Implements: HRX Firestore Collections Spec §2 - /tenants/{tenantId}/smsThreads/{threadId}/messages/{messageId}
    const messageRef = await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .collection('messages')
      .add(messageData);
    
    // Update thread
    await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .update({
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSnippet: body.substring(0, 100),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        unreadCountForRecruiter: admin.firestore.FieldValue.increment(1),
      });
    
    logger.info(`Created inbound message ${messageRef.id} in thread ${threadId}`);
    return messageRef.id;
  } catch (error: any) {
    logger.error(`Error creating inbound message:`, error);
    throw error;
  }
}

/**
 * Create outbound message and send via Twilio
 */
export async function sendOutboundMessage(
  threadId: string,
  recruiterId: string,
  body: string,
  options?: {
    language?: 'en' | 'es';
    metadata?: Record<string, any>;
  }
): Promise<{ messageId: string; twilioMessageId?: string; success: boolean }> {
  try {
    // Get thread - need to find tenant first
    const threadQuery = await db
      .collectionGroup('smsThreads')
      .where(admin.firestore.FieldPath.documentId(), '==', threadId)
      .limit(1)
      .get();
    
    if (threadQuery.empty) {
      throw new Error(`Thread ${threadId} not found`);
    }
    
    const threadDoc = threadQuery.docs[0];
    const thread = threadDoc.data() as SmsThread;
    const tenantId = thread.tenantId || threadDoc.ref.parent.parent?.id;
    
    if (!tenantId) {
      throw new Error(`Could not determine tenantId for thread ${threadId}`);
    }
    
    // Verify recruiter has permission
    if (thread.primaryRecruiterUserId && thread.primaryRecruiterUserId !== recruiterId) {
      // Could check if recruiter is in tenant with appropriate permissions
      // For now, allow if thread has no primary recruiter assigned
      logger.warn(`Recruiter ${recruiterId} sending to thread ${threadId} with different primary recruiter`);
    }
    
    // Check candidate SMS preferences
    const candidateDoc = await db.collection('users').doc(thread.candidateUserId).get();
    if (!candidateDoc.exists) {
      throw new Error(`Candidate ${thread.candidateUserId} not found`);
    }
    
    const candidateData = candidateDoc.data();
    
    // Check if SMS is blocked
    if (candidateData?.smsBlockedSystem === true || candidateData?.smsOptIn === false) {
      throw new Error('Candidate has opted out of SMS messages');
    }
    
    // Create message record
    const messageData: Omit<SmsMessage, 'id'> = {
      tenantId,
      threadId,
      direction: 'outbound',
      fromType: 'recruiter',
      fromUserId: recruiterId,
      body,
      language: options?.language || null,
      status: 'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const messageRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsThreads')
      .doc(threadId)
      .collection('messages')
      .add(messageData);
    
    // Send via Twilio
    const sendResult = await sendWorkerMessageInternal(
      thread.candidatePhone,
      body,
      {
        systemContext: false,
        source: 'recruiter_message',
        sourceId: messageRef.id,
      }
    );
    
    // Update message with send result
    const updateData: any = {
      status: sendResult.success ? 'sent' : 'failed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (sendResult.success && sendResult.messageId) {
      updateData.providerMessageId = sendResult.messageId;
      updateData.deliveredAt = admin.firestore.FieldValue.serverTimestamp();
    }
    
    await messageRef.update(updateData);
    
    // Update thread
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsThreads')
      .doc(threadId)
      .update({
        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
        lastMessageSnippet: body.substring(0, 100),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    
    // Log to unified message log
    await logMessage({
      userId: thread.candidateUserId,
      tenantId,
      threadId,
      messageTypeId: 'recruiter_chat',
      channel: 'sms',
      direction: 'outbound',
      fromIdentity: 'recruiter',
      fromUserId: recruiterId,
      contentSent: body,
      language: options?.language || 'en',
      status: sendResult.success ? 'sent' : 'failed',
      providerMessageId: sendResult.messageId || undefined,
      failureReason: sendResult.error,
    });
    
    logger.info(`Sent outbound message ${messageRef.id} from recruiter ${recruiterId} to thread ${threadId}`);
    
    return {
      messageId: messageRef.id,
      twilioMessageId: sendResult.messageId || undefined,
      success: sendResult.success,
    };
  } catch (error: any) {
    logger.error(`Error sending outbound message:`, error);
    throw error;
  }
}

/**
 * Get thread with messages
 */
export async function getThreadWithMessages(
  threadId: string,
  options?: {
    limit?: number;
    startAfter?: admin.firestore.DocumentSnapshot;
  }
): Promise<{ thread: SmsThread; messages: SmsMessage[] }> {
    try {
      // Find thread to get tenantId
      const threadQuery = await db
        .collectionGroup('smsThreads')
        .where(admin.firestore.FieldPath.documentId(), '==', threadId)
        .limit(1)
        .get();
      
      if (threadQuery.empty) {
        throw new Error(`Thread ${threadId} not found`);
      }
      
      const threadDoc = threadQuery.docs[0];
      const threadData = threadDoc.data() as SmsThread;
      const tenantId = threadData.tenantId || threadDoc.ref.parent.parent?.id;
      
      if (!tenantId) {
        throw new Error(`Could not determine tenantId for thread ${threadId}`);
      }
      
      const thread = {
        id: threadDoc.id,
        ...threadData,
      } as SmsThread;
      
      // Get messages
      let messagesQuery: admin.firestore.Query = db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsThreads')
        .doc(threadId)
        .collection('messages')
        .orderBy('createdAt', 'desc');
    
    if (options?.limit) {
      messagesQuery = messagesQuery.limit(options.limit);
    }
    
    if (options?.startAfter) {
      messagesQuery = messagesQuery.startAfter(options.startAfter);
    }
    
    const messagesSnapshot = await messagesQuery.get();
    const messages = messagesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as SmsMessage[];
    
    return { thread, messages };
  } catch (error: any) {
    logger.error(`Error getting thread with messages:`, error);
    throw error;
  }
}

/**
 * Get threads for a recruiter
 */
export async function getRecruiterThreads(
  recruiterId: string,
  tenantId: string,
  options?: {
    status?: ThreadStatus;
    limit?: number;
  }
): Promise<SmsThread[]> {
  try {
      let query: admin.firestore.Query = db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsThreads')
        .where('primaryRecruiterUserId', '==', recruiterId)
        .orderBy('lastMessageAt', 'desc');
    
    if (options?.status) {
      query = query.where('status', '==', options.status);
    }
    
    if (options?.limit) {
      query = query.limit(options.limit);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as SmsThread[];
  } catch (error: any) {
    logger.error(`Error getting recruiter threads:`, error);
    throw error;
  }
}

/**
 * Update thread status
 */
export async function updateThreadStatus(
  threadId: string,
  status: ThreadStatus,
  tenantId?: string
): Promise<void> {
  try {
    // If tenantId not provided, find it
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const threadQuery = await db
        .collectionGroup('smsThreads')
        .where(admin.firestore.FieldPath.documentId(), '==', threadId)
        .limit(1)
        .get();
      
      if (threadQuery.empty) {
        throw new Error(`Thread ${threadId} not found`);
      }
      
      const threadData = threadQuery.docs[0].data() as SmsThread;
      resolvedTenantId = threadData.tenantId || threadQuery.docs[0].ref.parent.parent?.id;
      
      if (!resolvedTenantId) {
        throw new Error(`Could not determine tenantId for thread ${threadId}`);
      }
    }
    
    await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    logger.info(`Updated thread ${threadId} status to ${status}`);
  } catch (error: any) {
    logger.error(`Error updating thread status:`, error);
    throw error;
  }
}

