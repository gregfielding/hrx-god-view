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
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

export type ThreadStatus = 'open' | 'snoozed' | 'closed' | 'spam';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageFromType = 'candidate' | 'recruiter' | 'system' | 'ai';
export type ParticipantType = 'user' | 'contact' | 'unknown';

export interface Participant {
  type: ParticipantType;
  id?: string;
  phoneE164: string;
  displayName?: string;
}

export interface SmsThread {
  id?: string;
  tenantId: string;                    // Required even though path encodes it
  
  // Normalized participant fields (NEW - preferred)
  participant?: Participant;           // The person receiving messages (candidate/contact)
  counterparty?: Participant;          // The recruiter/system sending messages
  
  // Legacy fields (keep for backward compatibility, but stop using in new code)
  candidateUserId?: string;            // Deprecated: use participant.id
  candidatePhone?: string;             // Deprecated: use participant.phoneE164
  primaryRecruiterUserId?: string | null; // Deprecated: use counterparty.id
  
  twilioNumber: string;                 // Number used for outbound messages
  status: ThreadStatus;
  threadStatus?: ThreadStatus;         // NEW: Explicit thread status (open/closed/spam)
  assignedToUserId?: string;           // NEW: Assigned recruiter
  
  lastMessageAt: Timestamp | FieldValue;
  lastInboundAt?: Timestamp | FieldValue; // NEW
  lastOutboundAt?: Timestamp | FieldValue; // NEW
  lastMessageSnippet?: string;          // From spec
  
  // Unread tracking (NEW: per-user)
  unreadCountForRecruiter?: number;    // Legacy: single count
  lastReadAtByUser?: { [uid: string]: Timestamp | FieldValue }; // NEW
  unreadCountByUser?: { [uid: string]: number }; // NEW
  
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
  
  // Optional metadata
  jobOrderId?: string;
  applicationId?: string;
  companyId?: string;                  // NEW: Linked company
  dealId?: string;                     // NEW: Linked deal
  locationId?: string;                 // NEW: Linked location
}

export interface SmsMessage {
  id?: string;
  tenantId: string;                     // Required even though path encodes it
  threadId: string;
  direction: MessageDirection;
  fromType: MessageFromType;
  fromUserId?: string;                  // Recruiter id, or null for candidate/system
  
  // NEW: Message source tracking
  source?: 'automation' | 'manual' | 'ai_suggested' | 'ai_sent';
  ai?: {
    suggestedByRunId?: string;
    approvedByUid?: string;
    model?: string;
    promptRef?: string;
  };
  
  body: string;
  language: 'en' | 'es' | null;
  providerMessageId?: string;           // Twilio message SID
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'not_sent';
  failureReason?: string;               // From spec
  createdAt: Timestamp | FieldValue;
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
    
    // Get candidate data to populate participant fields
    const candidateDoc = await db.collection('users').doc(candidateId).get();
    const candidateData = candidateDoc.exists ? candidateDoc.data() : null;
    const candidateDisplayName = candidateData 
      ? `${candidateData.firstName || ''} ${candidateData.lastName || ''}`.trim() || candidateData.email || 'Unknown'
      : 'Unknown';
    
    // Create new thread with normalized participant fields
    const threadData: Omit<SmsThread, 'id'> = {
      tenantId,
      
      // NEW: Normalized participant fields
      participant: {
        type: 'user',
        id: candidateId,
        phoneE164: candidatePhone,
        displayName: candidateDisplayName,
      },
      counterparty: options?.primaryRecruiterId ? {
        type: 'user',
        id: options.primaryRecruiterId,
        phoneE164: '', // Will be populated from recruiter number if needed
        displayName: '', // Will be populated from user data if needed
      } : undefined,
      
      // Legacy fields (for backward compatibility)
      candidateUserId: candidateId,
      candidatePhone: candidatePhone,
      primaryRecruiterUserId: options?.primaryRecruiterId || null,
      
      twilioNumber,
      status: 'open',
      threadStatus: 'open', // NEW: Explicit status
      assignedToUserId: options?.primaryRecruiterId || undefined, // NEW
      lastMessageAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
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
 * Queue-first helper: get or create an SMS thread for a user.
 * Plan B Phase 1 uses this to ensure system/programmatic SMS is reply-ready.
 */
export async function getOrCreateThreadForUser(params: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  twilioNumber: string;
  primaryRecruiterId?: string | null;
}): Promise<string> {
  const thread = await findOrCreateThread(
    params.userId,
    params.phoneE164,
    params.twilioNumber,
    params.tenantId,
    params.primaryRecruiterId ? { primaryRecruiterId: params.primaryRecruiterId } : undefined
  );

  if (!thread.id) {
    throw new Error('Failed to get or create SMS thread');
  }

  return thread.id;
}

/**
 * Create inbound message in thread
 */
export async function createInboundMessage(
  threadId: string,
  body: string,
  providerMessageId: string,
  options?: {
    tenantId?: string;
    language?: 'en' | 'es';
    metadata?: Record<string, any>;
  }
): Promise<string> {
  try {
    // For tenant-scoped messaging, the caller must provide tenantId.
    // (CollectionGroup + documentId equality requires a full document path, not a bare threadId.)
    const resolvedTenantId = options?.tenantId;
    if (!resolvedTenantId) {
      throw new Error(`Missing tenantId for inbound message thread ${threadId}`);
    }
    
    const messageData: Omit<SmsMessage, 'id'> = {
      tenantId: resolvedTenantId,
      threadId,
      direction: 'inbound',
      fromType: 'candidate',
      source: 'automation', // NEW: Inbound messages are automated (from Twilio webhook)
      body,
      language: options?.language || null,
      providerMessageId,
      status: 'delivered',
      createdAt: FieldValue.serverTimestamp(),
    };
    
    // Implements: HRX Firestore Collections Spec §2 - /tenants/{tenantId}/smsThreads/{threadId}/messages/{messageId}
    const messageRef = await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .collection('messages')
      .add(messageData);
    
    // Update thread with inbound-specific fields
    await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .update({
        lastMessageAt: FieldValue.serverTimestamp(),
        lastInboundAt: FieldValue.serverTimestamp(), // NEW
        lastMessageSnippet: body.substring(0, 100),
        updatedAt: FieldValue.serverTimestamp(),
        unreadCountForRecruiter: FieldValue.increment(1), // Legacy
        // NEW: Increment unread count for all users who have read this thread
        // (We'll update this more granularly when read tracking is implemented)
      });
    
    logger.info(`Created inbound message ${messageRef.id} in thread ${threadId}`);
    return messageRef.id;
  } catch (error: any) {
    logger.error(`Error creating inbound message:`, error);
    throw error;
  }
}

/**
 * Create outbound message and send via queue
 * Now uses Cloud Tasks queueing instead of direct Twilio calls
 */
export async function sendOutboundMessage(
  threadId: string,
  recruiterId: string,
  body: string,
  options?: {
    language?: 'en' | 'es';
    metadata?: Record<string, any>;
  }
): Promise<{ requestId: string; success: boolean }> {
  try {
    // Get thread - need to find tenant first
    const threadQuery = await db
      .collectionGroup('smsThreads')
      .where(FieldPath.documentId(), '==', threadId)
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
    
    // Get candidate phone (use normalized participant or legacy field)
    const candidatePhone = thread.participant?.phoneE164 || thread.candidatePhone;
    if (!candidatePhone) {
      throw new Error(`No phone number found for thread ${threadId}`);
    }
    
    // Get candidate user ID (use normalized participant or legacy field)
    const candidateUserId = thread.participant?.id || thread.candidateUserId;
    if (!candidateUserId) {
      throw new Error(`No candidate user ID found for thread ${threadId}`);
    }
    
    // Get Twilio number from thread
    const twilioNumber = thread.twilioNumber || '';
    
    // Create outbound request via queue (replaces direct Twilio call)
    const { createOutboundRequest } = await import('./smsOutboundQueue');
    const requestId = await createOutboundRequest({
      tenantId,
      threadId,
      toPhoneE164: candidatePhone,
      fromPhoneE164: twilioNumber,
      body,
      source: 'manual',
      requestedByUid: recruiterId,
      metadata: {
        applicationId: thread.applicationId,
        dealId: thread.dealId,
        companyId: thread.companyId,
        locationId: thread.locationId,
      },
    });
    
    logger.info(`Queued outbound message request ${requestId} from recruiter ${recruiterId} to thread ${threadId}`);
    
    return {
      requestId,
      success: true,
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
        .where(FieldPath.documentId(), '==', threadId)
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
        .where(FieldPath.documentId(), '==', threadId)
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
        threadStatus: status, // NEW: Update explicit status field
        updatedAt: FieldValue.serverTimestamp(),
      });
    logger.info(`Updated thread ${threadId} status to ${status}`);
  } catch (error: any) {
    logger.error(`Error updating thread status:`, error);
    throw error;
  }
}

/**
 * Assign thread to a recruiter
 */
export async function assignThread(
  threadId: string,
  recruiterId: string,
  tenantId?: string
): Promise<void> {
  try {
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const threadQuery = await db
        .collectionGroup('smsThreads')
        .where(FieldPath.documentId(), '==', threadId)
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
    
    // Get recruiter data for counterparty
    const recruiterDoc = await db.collection('users').doc(recruiterId).get();
    const recruiterData = recruiterDoc.exists ? recruiterDoc.data() : null;
    const recruiterDisplayName = recruiterData
      ? `${recruiterData.firstName || ''} ${recruiterData.lastName || ''}`.trim() || recruiterData.email || 'Unknown'
      : 'Unknown';
    
    await db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId)
      .update({
        assignedToUserId: recruiterId,
        counterparty: {
          type: 'user',
          id: recruiterId,
          phoneE164: recruiterData?.phoneE164 || '',
          displayName: recruiterDisplayName,
        },
        primaryRecruiterUserId: recruiterId, // Legacy field
        updatedAt: FieldValue.serverTimestamp(),
      });
    logger.info(`Assigned thread ${threadId} to recruiter ${recruiterId}`);
  } catch (error: any) {
    logger.error(`Error assigning thread:`, error);
    throw error;
  }
}

/**
 * Mark thread as read for a user
 */
export async function markThreadRead(
  threadId: string,
  userId: string,
  tenantId?: string
): Promise<void> {
  try {
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const threadQuery = await db
        .collectionGroup('smsThreads')
        .where(FieldPath.documentId(), '==', threadId)
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
    
    const threadRef = db
      .collection('tenants')
      .doc(resolvedTenantId)
      .collection('smsThreads')
      .doc(threadId);
    
    // Update lastReadAtByUser
    await threadRef.update({
      [`lastReadAtByUser.${userId}`]: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    
    logger.info(`Marked thread ${threadId} as read for user ${userId}`);
  } catch (error: any) {
    logger.error(`Error marking thread as read:`, error);
    throw error;
  }
}
