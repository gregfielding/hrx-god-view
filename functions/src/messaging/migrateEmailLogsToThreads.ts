/**
 * Migration: Sync email_logs and messageLogs to emailThreads
 * 
 * This function migrates existing email_logs and messageLogs (email channel) entries 
 * to the new emailThreads system. It groups emails by thread and creates 
 * corresponding emailThreads and messages.
 * 
 * This is idempotent - can be run multiple times safely.
 */

import * as admin from 'firebase-admin';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { findOrCreateEmailThread, normalizeSubject, extractEmailAddresses, findContactsByEmails, findContactDeal } from './emailThreading';

const db = admin.firestore();

interface EmailLogEntry {
  id: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
  subject?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  timestamp?: admin.firestore.Timestamp | Date;
  bodySnippet?: string;
  bodyHtml?: string;
  bodyPlain?: string;
  direction?: 'inbound' | 'outbound';
  contactId?: string;
  companyId?: string;
  dealId?: string;
  userId?: string;
  userEmail?: string;
  createdAt?: admin.firestore.Timestamp | Date;
  [key: string]: any;
}

interface ThreadGroup {
  threadKey: string;
  normalizedSubject: string;
  participants: Set<string>;
  contactIds: Set<string>;
  userIds: Set<string>;
  emails: EmailLogEntry[];
  earliestDate: Date;
  latestDate: Date;
  gmailThreadId?: string;
}

/**
 * Generate a thread key for grouping emails
 */
function generateThreadKey(emailLog: EmailLogEntry, allParticipants: Set<string>): string {
  // If we have a Gmail thread ID, use that
  if (emailLog.gmailThreadId) {
    return `gmail:${emailLog.gmailThreadId}`;
  }
  
  // Otherwise, use normalized subject + sorted participants
  const normalizedSubj = normalizeSubject(emailLog.subject || '');
  const sortedParticipants = Array.from(allParticipants).sort().join(',');
  return `subject:${normalizedSubj}:${sortedParticipants}`;
}

/**
 * Extract all participants from an email log entry
 */
function extractParticipants(emailLog: EmailLogEntry): string[] {
  const participants = new Set<string>();
  
  if (emailLog.from) {
    participants.add(emailLog.from.toLowerCase());
  }
  
  if (emailLog.to) {
    const toArray = Array.isArray(emailLog.to) ? emailLog.to : [emailLog.to];
    toArray.forEach(email => {
      if (email) participants.add(email.toLowerCase());
    });
  }
  
  if (emailLog.cc) {
    const ccArray = Array.isArray(emailLog.cc) ? emailLog.cc : [emailLog.cc];
    ccArray.forEach(email => {
      if (email) participants.add(email.toLowerCase());
    });
  }
  
  if (emailLog.bcc) {
    const bccArray = Array.isArray(emailLog.bcc) ? emailLog.bcc : [emailLog.bcc];
    bccArray.forEach(email => {
      if (email) participants.add(email.toLowerCase());
    });
  }
  
  return Array.from(participants);
}

/**
 * Group email logs by thread
 */
function groupEmailLogsByThread(emailLogs: EmailLogEntry[]): Map<string, ThreadGroup> {
  const threadGroups = new Map<string, ThreadGroup>();
  
  for (const emailLog of emailLogs) {
    const participants = new Set(extractParticipants(emailLog));
    const threadKey = generateThreadKey(emailLog, participants);
    
    if (!threadGroups.has(threadKey)) {
      const normalizedSubject = normalizeSubject(emailLog.subject || '');
      const timestamp = emailLog.timestamp instanceof admin.firestore.Timestamp 
        ? emailLog.timestamp.toDate() 
        : emailLog.timestamp instanceof Date 
          ? emailLog.timestamp 
          : emailLog.createdAt instanceof admin.firestore.Timestamp
            ? emailLog.createdAt.toDate()
            : emailLog.createdAt instanceof Date
              ? emailLog.createdAt
              : new Date();
      
      threadGroups.set(threadKey, {
        threadKey,
        normalizedSubject: normalizedSubject || emailLog.subject || '(no subject)',
        participants: new Set(participants),
        contactIds: new Set<string>(),
        userIds: new Set<string>(),
        emails: [],
        earliestDate: timestamp,
        latestDate: timestamp,
        gmailThreadId: emailLog.gmailThreadId,
      });
    }
    
    const group = threadGroups.get(threadKey)!;
    group.emails.push(emailLog);
    
    // Update date range
    const timestamp = emailLog.timestamp instanceof admin.firestore.Timestamp 
      ? emailLog.timestamp.toDate() 
      : emailLog.timestamp instanceof Date 
        ? emailLog.timestamp 
        : emailLog.createdAt instanceof admin.firestore.Timestamp
          ? emailLog.createdAt.toDate()
          : emailLog.createdAt instanceof Date
            ? emailLog.createdAt
            : new Date();
    
    if (timestamp < group.earliestDate) {
      group.earliestDate = timestamp;
    }
    if (timestamp > group.latestDate) {
      group.latestDate = timestamp;
    }
    
    // Collect contact IDs and user IDs
    if (emailLog.contactId) {
      group.contactIds.add(emailLog.contactId);
    }
    if (emailLog.userId) {
      group.userIds.add(emailLog.userId);
    }
    
    // Merge participants
    participants.forEach(p => group.participants.add(p));
  }
  
  return threadGroups;
}

/**
 * Migrate email_logs to emailThreads for a specific tenant
 */
export const migrateEmailLogsToThreads = onCall({
  cors: true,
  memory: '1GiB',
  timeoutSeconds: 540,
}, async (request) => {
  try {
    const { tenantId, batchSize = 100, dryRun = false, includeMessageLogs = true } = request.data;
    
    if (!tenantId) {
      throw new Error('tenantId is required');
    }
    
    logger.info(`Starting email migration for tenant ${tenantId}`, { batchSize, dryRun, includeMessageLogs });
    
    const allEmailLogs: EmailLogEntry[] = [];
    
    // Get all email_logs for this tenant
    const emailLogsRef = db.collection('tenants').doc(tenantId).collection('email_logs');
    const emailLogsSnapshot = await emailLogsRef
      .orderBy('timestamp', 'desc')
      .limit(batchSize)
      .get();
    
    logger.info(`Found ${emailLogsSnapshot.docs.length} email_logs to process`);
    
    // Convert email_logs to EmailLogEntry format
    emailLogsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      allEmailLogs.push({
        id: doc.id,
        ...data,
      });
    });
    
    // Also get messageLogs with email channel if requested
    if (includeMessageLogs) {
      const messageLogsRef = db.collection('messageLogs');
      const messageLogsSnapshot = await messageLogsRef
        .where('tenantId', '==', tenantId)
        .where('channel', '==', 'email')
        .orderBy('createdAt', 'desc')
        .limit(batchSize)
        .get();
      
      logger.info(`Found ${messageLogsSnapshot.docs.length} messageLogs (email) to process`);
      
      // Convert messageLogs to EmailLogEntry format
      messageLogsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        // Extract email addresses from contentSent or contentOriginal
        const content = data.contentOriginal || data.contentSent || '';
        const fromMatch = content.match(/From:\s*([^\n]+)/i);
        const toMatch = content.match(/To:\s*([^\n]+)/i);
        const subjectMatch = content.match(/Subject:\s*([^\n]+)/i);
        
        allEmailLogs.push({
          id: doc.id,
          gmailMessageId: data.providerMessageId,
          subject: subjectMatch ? subjectMatch[1].trim() : '',
          from: fromMatch ? fromMatch[1].trim() : data.fromUserId || '',
          to: toMatch ? toMatch[1].trim().split(',').map((e: string) => e.trim()) : [],
          timestamp: data.createdAt,
          bodySnippet: content.substring(0, 200),
          bodyPlain: content,
          direction: data.direction || 'outbound',
          userId: data.userId || data.fromUserId,
          createdAt: data.createdAt,
        });
      });
    }
    
    if (allEmailLogs.length === 0) {
      logger.info(`No email data found for tenant ${tenantId}`);
      return {
        success: true,
        message: 'No email data found to migrate',
        stats: {
          processed: 0,
          threadsCreated: 0,
          messagesCreated: 0,
          skipped: 0,
        },
      };
    }
    
    // Convert to EmailLogEntry format
    const emailLogs: EmailLogEntry[] = allEmailLogs;
    
    // Group by thread
    const threadGroups = groupEmailLogsByThread(emailLogs);
    logger.info(`Grouped into ${threadGroups.size} threads`);
    
    let threadsCreated = 0;
    let messagesCreated = 0;
    let skipped = 0;
    
    // Process each thread group
    for (const [threadKey, group] of threadGroups.entries()) {
      try {
        // Sort emails by date
        group.emails.sort((a, b) => {
          const dateA = a.timestamp instanceof admin.firestore.Timestamp 
            ? a.timestamp.toDate() 
            : a.timestamp instanceof Date 
              ? a.timestamp 
              : a.createdAt instanceof admin.firestore.Timestamp
                ? a.createdAt.toDate()
                : a.createdAt instanceof Date
                  ? a.createdAt
                  : new Date(0);
          const dateB = b.timestamp instanceof admin.firestore.Timestamp 
            ? b.timestamp.toDate() 
            : b.timestamp instanceof Date 
              ? b.timestamp 
              : b.createdAt instanceof admin.firestore.Timestamp
                ? b.createdAt.toDate()
                : b.createdAt instanceof Date
                  ? b.createdAt
                  : new Date(0);
          return dateA.getTime() - dateB.getTime();
        });
        
        // Check if thread already exists (by gmailThreadId or by participants/subject)
        let existingThreadId: string | null = null;
        
        if (group.gmailThreadId) {
          const existingByGmail = await db.collection('tenants').doc(tenantId)
            .collection('emailThreads')
            .where('gmailThreadId', '==', group.gmailThreadId)
            .limit(1)
            .get();
          
          if (!existingByGmail.empty) {
            existingThreadId = existingByGmail.docs[0].id;
            logger.info(`Thread already exists for gmailThreadId ${group.gmailThreadId}: ${existingThreadId}`);
          }
        }
        
        // If no existing thread found, create one
        if (!existingThreadId) {
          // Find contacts for participants
          const participantEmails = Array.from(group.participants);
          const contactMap = await findContactsByEmails(tenantId, participantEmails);
          
          // Update contactIds from contactMap
          contactMap.forEach((contact, contactId) => {
            group.contactIds.add(contactId);
          });
          
          // Find user IDs for participant emails
          const userIds: string[] = [];
          for (const email of participantEmails) {
            try {
              const userQuery = await db.collection('users')
                .where('email', '==', email.toLowerCase())
                .limit(1)
                .get();
              
              if (!userQuery.empty) {
                userIds.push(userQuery.docs[0].id);
                group.userIds.add(userQuery.docs[0].id);
              }
            } catch (err) {
              logger.warn(`Error finding user for email ${email}:`, err);
            }
          }
          
          if (!dryRun) {
            // Create the thread
            const threadData = {
              tenantId,
              gmailThreadId: group.gmailThreadId,
              subject: group.emails[0]?.subject || group.normalizedSubject,
              participants: participantEmails,
              participantUserIds: Array.from(group.userIds),
              participantContactIds: Array.from(group.contactIds),
              lastMessageAt: admin.firestore.Timestamp.fromDate(group.latestDate),
              lastMessageSnippet: group.emails[group.emails.length - 1]?.bodySnippet || '',
              unreadCount: 0, // Mark all as read for migrated emails
              messageCount: group.emails.length,
              status: 'active' as const,
              starred: false,
              labels: ['primary'], // Default to primary for migrated emails
              createdAt: admin.firestore.Timestamp.fromDate(group.earliestDate),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            
            const threadRef = await db.collection('tenants').doc(tenantId)
              .collection('emailThreads')
              .add(threadData);
            
            existingThreadId = threadRef.id;
            threadsCreated++;
            logger.info(`Created thread ${existingThreadId} for ${group.emails.length} emails`);
          } else {
            logger.info(`[DRY RUN] Would create thread for ${group.emails.length} emails`);
            skipped++;
            continue;
          }
        } else {
          skipped++;
          logger.info(`Skipping thread ${existingThreadId} (already exists)`);
        }
        
        // Create messages for each email log
        if (!dryRun && existingThreadId) {
          const threadRef = db.collection('tenants').doc(tenantId)
            .collection('emailThreads')
            .doc(existingThreadId);
          
          for (const emailLog of group.emails) {
            // Check if message already exists
            const existingMessage = await threadRef.collection('messages')
              .where('providerMessageId', '==', emailLog.gmailMessageId || emailLog.id)
              .limit(1)
              .get();
            
            if (!existingMessage.empty) {
              logger.info(`Message already exists for ${emailLog.gmailMessageId || emailLog.id}, skipping`);
              continue;
            }
            
            const timestamp = emailLog.timestamp instanceof admin.firestore.Timestamp 
              ? emailLog.timestamp 
              : emailLog.timestamp instanceof Date 
                ? admin.firestore.Timestamp.fromDate(emailLog.timestamp)
                : emailLog.createdAt instanceof admin.firestore.Timestamp
                  ? emailLog.createdAt
                  : emailLog.createdAt instanceof Date
                    ? admin.firestore.Timestamp.fromDate(emailLog.createdAt)
                    : admin.firestore.FieldValue.serverTimestamp();
            
            const toArray = Array.isArray(emailLog.to) ? emailLog.to : emailLog.to ? [emailLog.to] : [];
            const ccArray = Array.isArray(emailLog.cc) ? emailLog.cc : emailLog.cc ? [emailLog.cc] : [];
            const bccArray = Array.isArray(emailLog.bcc) ? emailLog.bcc : emailLog.bcc ? [emailLog.bcc] : [];
            
            const messageData = {
              tenantId,
              threadId: existingThreadId,
              gmailMessageId: emailLog.gmailMessageId,
              direction: emailLog.direction || (emailLog.from?.toLowerCase() === emailLog.userEmail?.toLowerCase() ? 'outbound' : 'inbound'),
              from: emailLog.from || '',
              fromUserId: emailLog.userId,
              to: toArray,
              cc: ccArray,
              bcc: bccArray,
              subject: emailLog.subject || group.normalizedSubject,
              bodyHtml: emailLog.bodyHtml,
              bodyPlain: emailLog.bodyPlain,
              bodySnippet: emailLog.bodySnippet || '',
              status: 'sent' as const,
              providerMessageId: emailLog.gmailMessageId || emailLog.id,
              read: true, // Mark all migrated emails as read
              readAt: timestamp,
              createdAt: timestamp,
            };
            
            await threadRef.collection('messages').add(messageData);
            messagesCreated++;
          }
          
          // Update thread message count and last message
          await threadRef.update({
            messageCount: admin.firestore.FieldValue.increment(group.emails.length),
            lastMessageAt: admin.firestore.Timestamp.fromDate(group.latestDate),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (err: any) {
        logger.error(`Error processing thread ${threadKey}:`, err);
        // Continue with next thread
      }
    }
    
    const stats = {
      processed: emailLogs.length,
      threadsCreated,
      messagesCreated,
      skipped,
    };
    
    logger.info(`Migration completed for tenant ${tenantId}`, stats);
    
    return {
      success: true,
      message: dryRun 
        ? `Dry run completed. Would create ${threadsCreated} threads and ${messagesCreated} messages.`
        : `Migration completed. Created ${threadsCreated} threads and ${messagesCreated} messages.`,
      stats,
    };
  } catch (err: any) {
    logger.error('Error in migrateEmailLogsToThreads:', err);
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
});

