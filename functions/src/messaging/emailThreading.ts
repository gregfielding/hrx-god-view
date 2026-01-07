/**
 * Email Threading System
 * 
 * Manages email conversations (threads) similar to Gmail.
 * Groups emails by conversation and provides thread management.
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export type EmailThreadStatus = 'active' | 'archived' | 'deleted';
export type EmailDirection = 'inbound' | 'outbound';

/**
 * Extract Gmail categories from labelIds
 * Gmail categories: CATEGORY_PERSONAL, CATEGORY_SOCIAL, CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_FORUMS, SPAM, DRAFT
 * If no category is found, default to 'primary' (Gmail's default category)
 */
export function extractGmailCategories(labelIds?: string[]): string[] {
  if (!labelIds || labelIds.length === 0) return ['primary']; // Default to primary if no labels
  
  const categories: string[] = [];
  
  // Gmail system categories
  if (labelIds.includes('CATEGORY_PERSONAL')) categories.push('primary');
  if (labelIds.includes('CATEGORY_SOCIAL')) categories.push('social');
  if (labelIds.includes('CATEGORY_PROMOTIONS')) categories.push('promotions');
  if (labelIds.includes('CATEGORY_UPDATES')) categories.push('updates');
  if (labelIds.includes('CATEGORY_FORUMS')) categories.push('forums');
  if (labelIds.includes('SPAM')) categories.push('spam');
  if (labelIds.includes('DRAFT')) categories.push('drafts');
  
  // If no category found but email is not spam, default to primary (Gmail's default)
  if (categories.length === 0 && !labelIds.includes('SPAM')) {
    categories.push('primary');
  }
  
  return categories;
}

export interface ParticipantContact {
  email: string;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
  userId?: string;
  userName?: string;
  dealIds?: string[];
}

export interface EmailThread {
  id?: string;
  tenantId: string;
  gmailThreadId?: string; // Gmail's thread ID if synced from Gmail
  subject: string;
  participants: string[]; // Array of email addresses
  participantUserIds?: string[]; // Array of user IDs (if users exist in system)
  participantContactIds?: string[]; // Array of contact IDs (for quick lookup)
  participantContacts?: ParticipantContact[]; // Enriched contact information
  lastMessageAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  lastMessageSnippet?: string;
  unreadCount: number;
  messageCount: number;
  status: EmailThreadStatus;
  starred?: boolean;
  labels?: string[]; // For future folder/label support
  archivedAt?: admin.firestore.Timestamp; // When thread was archived
  archivedBy?: string; // User who archived the thread
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface EmailMessage {
  id?: string;
  tenantId: string;
  threadId: string;
  gmailMessageId?: string; // Gmail's message ID if synced from Gmail
  direction: EmailDirection;
  from: string; // Email address
  fromUserId?: string; // User ID if sender is a system user
  to: string[]; // Array of email addresses
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml?: string;
  bodyPlain?: string;
  bodySnippet?: string;
  attachments?: EmailAttachment[];
  status: 'sent' | 'delivered' | 'failed' | 'draft';
  providerMessageId?: string; // SendGrid message ID, Gmail message ID, etc.
  failureReason?: string;
  read: boolean;
  readAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number; // bytes
  storagePath: string; // Firebase Storage path
  downloadUrl?: string; // Signed URL (temporary)
}

/**
 * Normalize subject for thread matching
 * Removes "Re:", "Fwd:", etc. and trims whitespace
 */
export function normalizeSubject(subject: string): string {
  if (!subject) return '';
  // Remove Re:/Fwd: prefixes but preserve important identifiers in brackets
  // For automated emails (like Fieldglass), job posting IDs in brackets are important
  // So we only remove brackets if they're at the very end or if they contain common non-identifying text
  let normalized = subject.replace(/^(re|fwd|fw):\s*/i, '').trim();
  
  // Only remove brackets that are clearly not identifiers (like [Action required], [External], etc.)
  // Keep brackets that look like IDs (contain numbers, colons, or are in specific formats)
  normalized = normalized.replace(/\[(Action required|External|Fwd|Re|Important|Urgent|Spam)\]/gi, '');
  
  return normalized.trim();
}

/**
 * Extract email addresses from a string
 */
export function extractEmailAddresses(text: string): string[] {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailRegex) || [];
  return matches.map(email => email.toLowerCase());
}

/**
 * Find CRM contacts by email addresses
 * Returns a map of email -> contact data
 */
export async function findContactsByEmails(
  tenantId: string,
  emailAddresses: string[]
): Promise<Map<string, { id: string; email: string; companyId?: string; fullName?: string; firstName?: string; lastName?: string; [key: string]: any }>> {
  const contactMap = new Map();
  
  if (!emailAddresses || emailAddresses.length === 0) {
    return contactMap;
  }

  // Firestore 'in' query limit is 10, so we need to batch
  const uniqueEmails = Array.from(new Set(emailAddresses.map(e => e.toLowerCase())));
  
  // Process in batches of 10
  for (let i = 0; i < uniqueEmails.length; i += 10) {
    const batch = uniqueEmails.slice(i, i + 10);
    if (batch.length === 0) continue;
    
    try {
      const contactQuery = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('crm_contacts')
        .where('email', 'in', batch)
        .get();
      
      contactQuery.docs.forEach(doc => {
        const contactData = doc.data();
        const email = (contactData.email || '').toLowerCase();
        if (email) {
          contactMap.set(email, {
            id: doc.id,
            email: contactData.email,
            companyId: contactData.companyId,
            fullName: contactData.fullName,
            firstName: contactData.firstName,
            lastName: contactData.lastName,
            ...contactData,
          });
        }
      });
    } catch (err) {
      logger.warn(`Failed to query contacts for batch: ${batch.join(', ')}`, err);
    }
  }
  
  return contactMap;
}

/**
 * Find the most relevant deal for a contact
 */
export async function findContactDeal(
  tenantId: string,
  contactId: string
): Promise<string | null> {
  try {
    const dealQuery = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('crm_deals')
      .where('associations.contacts', 'array-contains', contactId)
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    
    if (!dealQuery.empty) {
      return dealQuery.docs[0].id;
    }
  } catch (err) {
    logger.warn(`Failed to find deal for contact ${contactId}:`, err);
  }
  
  return null;
}

/**
 * Find or create email thread
 * 
 * Threads are matched by Gmail threadId ONLY (mimics Gmail's default behavior).
 * If no gmailThreadId is provided, a new thread is created.
 */
export async function findOrCreateEmailThread(
  tenantId: string,
  emailData: {
    subject: string;
    from: string;
    to: string[];
    cc?: string[];
    gmailThreadId?: string;
    gmailLabelIds?: string[]; // Gmail labelIds to extract categories from
  },
  options?: {
    userId?: string; // User who owns this email (for participant matching)
  }
): Promise<EmailThread> {
  try {
    // Collect all participants
    const allParticipants = [
      emailData.from,
      ...emailData.to,
      ...(emailData.cc || []),
    ]
      .map(extractEmailAddresses)
      .flat()
      .filter(Boolean);

    const uniqueParticipants = Array.from(new Set(allParticipants));

    // Try to find existing thread
    let existingThread: EmailThread | null = null;

    // First, try by Gmail threadId if available
    if (emailData.gmailThreadId) {
      const gmailThreadQuery = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('emailThreads')
        .where('gmailThreadId', '==', emailData.gmailThreadId)
        .limit(1)
        .get();

      if (!gmailThreadQuery.empty) {
        const doc = gmailThreadQuery.docs[0];
        existingThread = {
          id: doc.id,
          ...doc.data(),
        } as EmailThread;
      }
    }

    // If gmailThreadId was provided but thread not found, log info and create new thread
    // This is normal for the first email in a Gmail thread
    if (!existingThread && emailData.gmailThreadId) {
      logger.info(`Creating new thread for Gmail threadId ${emailData.gmailThreadId}, subject: ${emailData.subject}`);
    }

    // Extract Gmail categories from labelIds
    const categories = extractGmailCategories(emailData.gmailLabelIds);
    
    // Return existing thread if found
    if (existingThread && existingThread.id) {
      // Always update labels (categories will default to 'primary' if none found)
      const existingLabels = existingThread.labels || [];
      const updatedLabels = Array.from(new Set([...existingLabels, ...categories]));
      // Update if labels changed or if thread has no labels yet
      if (updatedLabels.length !== existingLabels.length || existingLabels.length === 0) {
        await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .doc(existingThread.id)
          .update({
            labels: updatedLabels,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        existingThread.labels = updatedLabels;
      }
      return existingThread;
    }

    // Create new thread
    const threadData: Omit<EmailThread, 'id'> = {
      tenantId,
      gmailThreadId: emailData.gmailThreadId,
      subject: emailData.subject,
      participants: uniqueParticipants,
      participantUserIds: options?.userId ? [options.userId] : [],
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      unreadCount: 0,
      messageCount: 0,
      status: 'active',
      starred: false,
      labels: categories,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const threadRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .add(threadData);

    logger.info(`Created new email thread ${threadRef.id} for subject: ${emailData.subject}`);

    return {
      id: threadRef.id,
      ...threadData,
    } as EmailThread;
  } catch (error: any) {
    logger.error(`Error finding/creating email thread:`, error);
    throw error;
  }
}

/**
 * Add message to thread
 */
export async function addMessageToThread(
  threadId: string,
  tenantId: string,
  message: Omit<EmailMessage, 'id' | 'threadId' | 'tenantId' | 'createdAt'> & {
    createdAt?: Date | admin.firestore.Timestamp; // Optional: use original email timestamp
  }
): Promise<string> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    const threadDoc = await threadRef.get();
    if (!threadDoc.exists) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const threadData = threadDoc.data() as EmailThread;

    // Use provided timestamp if available (for Gmail sync), otherwise use server timestamp
    let createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
    if (message.createdAt) {
      if (message.createdAt instanceof Date) {
        createdAt = admin.firestore.Timestamp.fromDate(message.createdAt);
      } else if (message.createdAt instanceof admin.firestore.Timestamp) {
        createdAt = message.createdAt;
      } else {
        createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
    } else {
      createdAt = admin.firestore.FieldValue.serverTimestamp();
    }

    // Create message
    const messageData: Omit<EmailMessage, 'id'> = {
      ...message,
      threadId,
      tenantId,
      read: message.direction === 'outbound', // Outbound messages are auto-read
      createdAt,
    };

    const messageRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId)
      .collection('messages')
      .add(messageData);

    // Update thread
    const updates: Partial<EmailThread> = {
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageSnippet: message.bodySnippet || message.bodyPlain?.substring(0, 100) || '',
      messageCount: (threadData.messageCount || 0) + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Increment unread count if inbound
    if (message.direction === 'inbound' && !message.read) {
      updates.unreadCount = (threadData.unreadCount || 0) + 1;
    }

    // Update participants if new email addresses
    const newParticipants = [
      message.from,
      ...message.to,
      ...(message.cc || []),
    ]
      .map(extractEmailAddresses)
      .flat()
      .filter(Boolean)
      .map(p => p.toLowerCase());

    const existingParticipants = new Set((threadData.participants || []).map(p => p.toLowerCase()));
    const allParticipants = Array.from(new Set([...existingParticipants, ...newParticipants]));

    if (allParticipants.length > threadData.participants.length) {
      updates.participants = allParticipants;
    }

    await threadRef.update(updates);

    logger.info(`Added message ${messageRef.id} to thread ${threadId}`);

    return messageRef.id;
  } catch (error: any) {
    logger.error(`Error adding message to thread:`, error);
    throw error;
  }
}

/**
 * Get thread with messages
 */
export async function getThreadWithMessages(
  threadId: string,
  tenantId: string,
  options?: {
    limit?: number;
    startAfter?: admin.firestore.DocumentSnapshot;
  }
): Promise<{ thread: EmailThread; messages: EmailMessage[] }> {
  try {
    // Get thread
    const threadDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId)
      .get();

    if (!threadDoc.exists) {
      throw new Error(`Thread ${threadId} not found`);
    }

    const thread = {
      id: threadDoc.id,
      ...threadDoc.data(),
    } as EmailThread;

    // Get messages
    let messagesQuery = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
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
    })) as EmailMessage[];

    return { thread, messages };
  } catch (error: any) {
    logger.error(`Error getting thread with messages:`, error);
    throw error;
  }
}

/**
 * Mark thread as read
 */
export async function markThreadRead(
  threadId: string,
  tenantId: string,
  userId: string
): Promise<void> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    // Mark all unread messages in thread as read
    const messagesQuery = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId)
      .collection('messages')
      .where('read', '==', false)
      .where('direction', '==', 'inbound')
      .get();

    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const messageDoc of messagesQuery.docs) {
      batch.update(messageDoc.ref, {
        read: true,
        readAt: now,
      });
    }

    // Update thread unread count
    batch.update(threadRef, {
      unreadCount: 0,
      updatedAt: now,
    });

    await batch.commit();

    logger.info(`Marked thread ${threadId} as read for user ${userId}`);
  } catch (error: any) {
    logger.error(`Error marking thread as read:`, error);
    throw error;
  }
}

/**
 * Get user's email threads
 */
export async function getUserEmailThreads(
  userId: string,
  tenantId: string,
  options?: {
    status?: EmailThreadStatus;
    limit?: number;
    unreadOnly?: boolean;
    category?: string; // Gmail category: primary, social, promotions, updates, forums, spam, drafts
    sentOnly?: boolean; // Only return threads where user sent at least one message
  }
): Promise<EmailThread[]> {
  try {
    // Get user's email address
    const userDoc = await db.collection('users').doc(userId).get();
    const userData = userDoc.data();
    const userEmail = userData?.email?.toLowerCase();

    if (!userEmail) {
      logger.warn(`User ${userId} has no email address`);
      return [];
    }

    // Query threads where user is a participant
    // Note: We can't use != with orderBy, so we'll filter in memory
    let threadsQuery = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .where('participants', 'array-contains', userEmail)
      .orderBy('lastMessageAt', 'desc');

    // Apply status filter if specified (== only, not !=)
    if (options?.status) {
      threadsQuery = threadsQuery.where('status', '==', options.status);
    }

    // Note: We filter unreadOnly in memory to avoid composite index requirements
    // Apply limit (get more to filter out deleted/unread in memory)
    if (options?.limit) {
      threadsQuery = threadsQuery.limit(options.limit * 3); // Get more to filter out deleted/unread
    } else {
      threadsQuery = threadsQuery.limit(150); // Default limit (increased to account for filtering)
    }

    const snapshot = await threadsQuery.get();

    // Filter out deleted threads in memory (since != requires composite index)
    let threads = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as EmailThread[];

    // Filter out deleted if no specific status was requested
    if (!options?.status) {
      threads = threads.filter(thread => thread.status !== 'deleted');
    }

    // Filter unread threads in memory (to avoid composite index requirements)
    if (options?.unreadOnly) {
      threads = threads.filter(thread => (thread.unreadCount || 0) > 0);
    }

    // Filter by Gmail category in memory
    // Note: Exclude sent-only threads from category filters (they should only appear in "Sent")
    if (options?.category) {
      // First, filter by category label
      let categoryFilteredThreads = threads.filter(thread => {
        const labels = thread.labels || [];
        // For 'primary', show threads with 'primary' label OR threads with no labels (uncategorized)
        if (options.category === 'primary') {
          return labels.length === 0 || labels.includes('primary');
        } else {
          // For other categories, only show threads with that specific label
          return labels.includes(options.category!);
        }
      });
      
      // Then, exclude sent-only threads by checking for inbound messages
      // Use parallel queries with timeout to avoid performance issues
      const threadsWithCategory: EmailThread[] = [];
      
      // Limit the number of threads to check to prevent timeouts
      const threadsToCheck = categoryFilteredThreads.slice(0, 50); // Reduced from 100 to 50 for better performance
      const remainingThreads = categoryFilteredThreads.slice(50); // Include the rest without checking
      
      const checkPromises = threadsToCheck.map(async (thread) => {
        if (!thread.id) return null;
        
        try {
          // Use Promise.race with timeout to prevent hanging queries
          const queryPromise = db
            .collection('tenants')
            .doc(tenantId)
            .collection('emailThreads')
            .doc(thread.id)
            .collection('messages')
            .where('direction', '==', 'inbound')
            .limit(1)
            .get();
          
          const timeoutPromise = new Promise<null>((resolve) => {
            setTimeout(() => {
              logger.warn(`Timeout checking inbound messages for thread ${thread.id}`);
              resolve(null); // Resolve with null on timeout instead of rejecting
            }, 1500); // Reduced timeout from 2s to 1.5s
          });
          
          const inboundMessagesQuery = await Promise.race([queryPromise, timeoutPromise]);
          
          // Only include if thread has at least one inbound message (and no timeout occurred)
          if (inboundMessagesQuery && !inboundMessagesQuery.empty) {
            return thread;
          }
        } catch (err) {
          // If query fails, exclude the thread (conservative approach)
          logger.warn(`Failed to check inbound messages for thread ${thread.id}:`, err);
          return null;
        }
        
        return null;
      });
      
      const results = await Promise.all(checkPromises);
      threadsWithCategory.push(...results.filter((t): t is EmailThread => t !== null));
      
      // Include remaining threads without checking (to avoid timeout)
      // This is a trade-off: we might include some sent-only threads, but it prevents timeouts
      threadsWithCategory.push(...remainingThreads);
      
      threads = threadsWithCategory;
    }

    // Filter by sent only - check if thread has any outbound messages from this user
    if (options?.sentOnly) {
      const threadsWithSentMessages: EmailThread[] = [];
      
      for (const thread of threads) {
        if (!thread.id) continue;
        
        // Check messages subcollection for outbound messages from this user
        const messagesQuery = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .doc(thread.id)
          .collection('messages')
          .where('direction', '==', 'outbound')
          .where('fromUserId', '==', userId)
          .limit(1)
          .get();
        
        if (!messagesQuery.empty) {
          threadsWithSentMessages.push(thread);
        }
      }
      
      threads = threadsWithSentMessages;
    }

    // Apply limit after filtering
    if (options?.limit && threads.length > options.limit) {
      threads = threads.slice(0, options.limit);
    }

    return threads;
  } catch (error: any) {
    logger.error(`Error getting user email threads:`, error);
    throw error;
  }
}

/**
 * Archive a thread
 */
export async function archiveThread(
  threadId: string,
  tenantId: string,
  userId: string
): Promise<{ gmailThreadId?: string }> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    // Get thread to check for Gmail thread ID
    const threadDoc = await threadRef.get();
    const threadData = threadDoc.data() as EmailThread | undefined;
    const gmailThreadId = threadData?.gmailThreadId;

    await threadRef.update({
      status: 'archived',
      archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      archivedBy: userId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Archived thread ${threadId} by user ${userId}`);

    return { gmailThreadId };
  } catch (error: any) {
    logger.error(`Error archiving thread:`, error);
    throw error;
  }
}

/**
 * Unarchive a thread (restore to active)
 */
export async function unarchiveThread(
  threadId: string,
  tenantId: string,
  userId: string
): Promise<{ gmailThreadId?: string }> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    // Get thread to check for Gmail thread ID
    const threadDoc = await threadRef.get();
    const threadData = threadDoc.data() as EmailThread | undefined;
    const gmailThreadId = threadData?.gmailThreadId;

    await threadRef.update({
      status: 'active',
      archivedAt: admin.firestore.FieldValue.delete(),
      archivedBy: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Unarchived thread ${threadId} by user ${userId}`);

    return { gmailThreadId };
  } catch (error: any) {
    logger.error(`Error unarchiving thread:`, error);
    throw error;
  }
}

/**
 * Star/unstar a thread
 */
export async function starThread(
  threadId: string,
  tenantId: string,
  starred: boolean
): Promise<void> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    await threadRef.update({
      starred,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`${starred ? 'Starred' : 'Unstarred'} thread ${threadId}`);
  } catch (error: any) {
    logger.error(`Error starring thread:`, error);
    throw error;
  }
}

/**
 * Update email thread (general update function)
 */
export async function updateEmailThread(
  threadId: string,
  tenantId: string,
  updates: Partial<EmailThread>
): Promise<void> {
  try {
    const threadRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('emailThreads')
      .doc(threadId);

    await threadRef.update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Updated thread ${threadId}`);
  } catch (error: any) {
    logger.error(`Error updating thread:`, error);
    throw error;
  }
}

/**
 * Bulk update threads
 */
export async function bulkUpdateThreads(
  threadIds: string[],
  tenantId: string,
  updates: Partial<EmailThread>
): Promise<void> {
  try {
    const batch = db.batch();
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const threadId of threadIds) {
      const threadRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('emailThreads')
        .doc(threadId);

      batch.update(threadRef, {
        ...updates,
        updatedAt: now,
      });
    }

    await batch.commit();
    logger.info(`Bulk updated ${threadIds.length} threads`);
  } catch (error: any) {
    logger.error(`Error bulk updating threads:`, error);
    throw error;
  }
}

