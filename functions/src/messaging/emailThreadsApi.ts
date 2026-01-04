/**
 * Email Threads API
 * 
 * Handles email thread and message management for Gmail-like inbox.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  findOrCreateEmailThread,
  addMessageToThread,
  getThreadWithMessages,
  markThreadRead,
  getUserEmailThreads,
  archiveThread,
  unarchiveThread,
  starThread,
  bulkUpdateThreads,
  EmailThread,
  EmailMessage,
  findContactsByEmails,
  findContactDeal,
} from './emailThreading';
import { getEmailProvider } from './emailProviderFactory';
import { resolveSenderIdentity } from './senderIdentity';
import { logMessage } from './messageLogging';
import {
  syncReadStateToGmail,
  syncArchiveStateToGmail,
  syncDeleteStateToGmail,
} from './gmailTwoWaySync';
import { enrichThreadWithContacts } from './contactLinking';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * GET /api/email/threads
 * 
 * List email threads for a user (inbox view).
 */
export const listEmailThreadsApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      // TODO: Add authentication
      const userId = request.query.userId as string;
      const tenantId = request.query.tenantId as string;
      const { status, unreadOnly, limit, category, sentOnly } = request.query;

      if (!userId || !tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'userId and tenantId are required' },
        });
        return;
      }

      const threads = await getUserEmailThreads(userId, tenantId, {
        status: status as 'active' | 'archived' | 'deleted' | undefined,
        unreadOnly: unreadOnly === 'true',
        limit: limit ? Number(limit) : 50,
        category: category as string | undefined,
        sentOnly: sentOnly === 'true',
      });

      // Enrich threads with contact information (temporarily disabled for stability)
      // TODO: Re-enable after optimizing contact lookup performance
      let enrichedThreads = threads;
      
      // Temporarily disable enrichment to prevent timeouts
      // Contact enrichment will be re-enabled after performance optimization
      /*
      try {
        const { enrichThreadWithContacts } = await import('./contactLinking');
        
        // Only enrich if we have a reasonable number of threads (avoid timeout)
        if (threads.length <= 20) {
          // Process enrichment with individual error handling per thread
          enrichedThreads = await Promise.all(
            threads.map(async (thread) => {
              try {
                const participantContacts = await enrichThreadWithContacts(
                  thread.id || '',
                  tenantId,
                  thread.participants || []
                );
                return {
                  ...thread,
                  participantContacts,
                };
              } catch (error: any) {
                // Log but continue without enrichment for this thread
                logger.warn(`Failed to enrich thread ${thread.id} with contacts: ${error.message}`);
                return thread;
              }
            })
          );
        } else {
          // For large batches, skip enrichment to avoid timeout
          logger.info(`Skipping contact enrichment for ${threads.length} threads to avoid timeout`);
        }
      } catch (error: any) {
        // If enrichment fails entirely, log but continue with unenriched threads
        logger.error(`Failed to enrich threads with contacts: ${error.message}`, { error });
        // Continue with unenriched threads - don't fail the entire request
        enrichedThreads = threads;
      }
      */

      // Serialize Firestore Timestamps to ISO strings for consistent frontend parsing
      const serializedThreads = enrichedThreads.map(thread => {
        const serializeTimestamp = (value: any): any => {
          if (!value) return value;
          if (value instanceof admin.firestore.Timestamp) {
            return value.toDate().toISOString();
          }
          if (value && typeof value.toDate === 'function') {
            return value.toDate().toISOString();
          }
          return value;
        };

        return {
          ...thread,
          lastMessageAt: serializeTimestamp(thread.lastMessageAt),
          createdAt: serializeTimestamp(thread.createdAt),
          updatedAt: serializeTimestamp(thread.updatedAt),
        };
      });

      response.status(200).json({
        success: true,
        threads: serializedThreads,
        total: serializedThreads.length,
      });
    } catch (error: any) {
      logger.error('Error in listEmailThreadsApi:', error);
      logger.error('Error stack:', error.stack);
      response.set('Access-Control-Allow-Origin', '*');
      
      // Check if it's a Firestore index building error
      if (error.code === 9 || error.message?.includes('index') || error.message?.includes('FAILED_PRECONDITION')) {
        response.status(503).json({
          success: false,
          error: { 
            code: 'INDEX_BUILDING', 
            message: 'Database index is building. Please try again in a few minutes.' 
          },
        });
        return;
      }
      
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * GET /api/email/threads/:threadId
 * 
 * Get thread with messages (conversation view).
 */
export const getEmailThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      const threadId = request.query.threadId as string;
      const tenantId = request.query.tenantId as string;
      const { limit } = request.query;

      if (!threadId || !tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId and tenantId are required' },
        });
        return;
      }

      const { thread, messages } = await getThreadWithMessages(threadId, tenantId, {
        limit: limit ? Number(limit) : 100,
      });

      // Fallback: If thread has no messages, try to load from email_logs using gmailThreadId
      let finalMessages = messages;
      let messagesSource = 'thread_messages_subcollection';
      logger.info(`Thread ${threadId} loaded with ${messages.length} messages from thread messages subcollection, gmailThreadId: ${thread.gmailThreadId || 'none'}, subject: ${thread.subject || 'none'}`);
      
      if (messages.length === 0 && thread.gmailThreadId) {
        logger.info(`Thread ${threadId} has no messages, attempting to load from email_logs using gmailThreadId ${thread.gmailThreadId}`);
        try {
          // Query by gmailThreadId and filter by subject AND participants to ensure we only get messages from THIS specific thread
          const normalizedSubject = thread.subject?.replace(/^(Re:|Fwd?:|Fw:)\s*/i, '').trim() || '';
          const threadParticipants = (thread.participants || []).map(p => p.toLowerCase());
          
          // Query by gmailThreadId first
          let emailLogsQuery = db
            .collection('tenants')
            .doc(tenantId)
            .collection('email_logs')
            .where('threadId', '==', thread.gmailThreadId);
          
          // If we have a subject, also filter by it to ensure we only get messages from the same conversation
          if (normalizedSubject) {
            emailLogsQuery = emailLogsQuery.where('subject', '==', thread.subject);
          }
          
          const emailLogsSnapshot = await emailLogsQuery.limit(100).get();
          
          logger.info(`email_logs query returned ${emailLogsSnapshot.docs.length} documents (filtered by gmailThreadId${normalizedSubject ? ' and subject' : ''})`);
          
          // Filter by participants in memory to ensure we only get emails that belong to THIS thread
          let filteredDocs = emailLogsSnapshot.docs;
          if (threadParticipants.length > 0) {
            filteredDocs = filteredDocs.filter(doc => {
              const log = doc.data();
              const logFrom = (log.from || '').toLowerCase();
              const logTo = Array.isArray(log.to) ? log.to.map((e: string) => e.toLowerCase()) : [(log.to || '').toLowerCase()];
              const logCc = Array.isArray(log.cc) ? log.cc.map((e: string) => e.toLowerCase()) : [(log.cc || '').toLowerCase()];
              
              // Check if the email's participants overlap with the thread's participants
              const emailParticipants = new Set([logFrom, ...logTo, ...logCc].filter(Boolean));
              const hasParticipantOverlap = threadParticipants.some(p => emailParticipants.has(p));
              
              return hasParticipantOverlap;
            });
            logger.info(`After participant filtering: ${filteredDocs.length} documents match thread participants`);
          }
          
          // If no results with subject filter, try without subject filter (in case subject doesn't match exactly)
          let sortedDocs = filteredDocs;
          if (sortedDocs.length === 0 && normalizedSubject) {
            logger.info(`No results with subject filter, trying without subject filter`);
            const emailLogsQueryNoSubject = await db
              .collection('tenants')
              .doc(tenantId)
              .collection('email_logs')
              .where('threadId', '==', thread.gmailThreadId)
              .limit(100)
              .get();
            
            // Filter by participants even when no subject filter
            let noSubjectFiltered = emailLogsQueryNoSubject.docs;
            if (threadParticipants.length > 0) {
              noSubjectFiltered = emailLogsQueryNoSubject.docs.filter(doc => {
                const log = doc.data();
                const logFrom = (log.from || '').toLowerCase();
                const logTo = Array.isArray(log.to) ? log.to.map((e: string) => e.toLowerCase()) : [(log.to || '').toLowerCase()];
                const logCc = Array.isArray(log.cc) ? log.cc.map((e: string) => e.toLowerCase()) : [(log.cc || '').toLowerCase()];
                
                const emailParticipants = new Set([logFrom, ...logTo, ...logCc].filter(Boolean));
                const hasParticipantOverlap = threadParticipants.some(p => emailParticipants.has(p));
                
                return hasParticipantOverlap;
              });
            }
            
            sortedDocs = noSubjectFiltered;
            logger.info(`email_logs query (no subject filter, with participant filter) returned ${sortedDocs.length} documents`);
          }
          
          // Sort in memory to avoid index requirement
          sortedDocs = sortedDocs.sort((a, b) => {
            const getDate = (doc: any): Date => {
              const data = doc.data();
              if (data.timestamp) {
                return data.timestamp instanceof admin.firestore.Timestamp 
                  ? data.timestamp.toDate() 
                  : data.timestamp.toDate?.() || new Date(data.timestamp) || new Date(0);
              }
              if (data.createdAt) {
                return data.createdAt instanceof admin.firestore.Timestamp 
                  ? data.createdAt.toDate() 
                  : data.createdAt.toDate?.() || new Date(data.createdAt) || new Date(0);
              }
              return new Date(0);
            };
            return getDate(b).getTime() - getDate(a).getTime(); // Descending
          });

          if (sortedDocs.length > 0) {
            messagesSource = 'email_logs_fallback';
            logger.info(`Found ${sortedDocs.length} email_logs entries for thread ${threadId} (after participant filtering), converting to messages`);
            finalMessages = sortedDocs.map(doc => {
              const log = doc.data();
              return {
                id: doc.id,
                tenantId,
                threadId,
                direction: log.direction || 'inbound',
                from: log.from || '',
                to: Array.isArray(log.to) ? log.to : [log.to].filter(Boolean),
                cc: Array.isArray(log.cc) ? log.cc : [log.cc].filter(Boolean),
                subject: log.subject || '',
                bodyHtml: log.bodyHtml || '',
                bodyPlain: log.bodySnippet || '',
                bodySnippet: log.bodySnippet || '',
                status: 'delivered',
                providerMessageId: log.messageId,
                gmailMessageId: log.messageId,
                read: log.direction === 'outbound',
                createdAt: log.timestamp || log.createdAt,
              };
            });
            logger.info(`Converted ${finalMessages.length} email_logs to messages for thread ${threadId}`);
          } else {
            logger.warn(`No email_logs found for thread ${threadId} with gmailThreadId ${thread.gmailThreadId} matching participants`);
          }
        } catch (fallbackError: any) {
          logger.error(`Failed to load messages from email_logs fallback: ${fallbackError.message}`, { error: fallbackError });
        }
      } else if (messages.length === 0 && !thread.gmailThreadId) {
        logger.warn(`Thread ${threadId} has no messages and no gmailThreadId, cannot use email_logs fallback`);
      }

      // Serialize Firestore Timestamps in messages
      const serializeMessageTimestamp = (value: any): any => {
        if (!value) return value;
        if (value instanceof admin.firestore.Timestamp) {
          return value.toDate().toISOString();
        }
        if (value && typeof value.toDate === 'function') {
          return value.toDate().toISOString();
        }
        return value;
      };

      const serializedMessages = finalMessages.map(msg => ({
        ...msg,
        createdAt: serializeMessageTimestamp(msg.createdAt),
      }));

      // Serialize thread timestamps
      const serializeTimestamp = (value: any): any => {
        if (!value) return value;
        if (value instanceof admin.firestore.Timestamp) {
          return value.toDate().toISOString();
        }
        if (value && typeof value.toDate === 'function') {
          return value.toDate().toISOString();
        }
        return value;
      };

      // Enrich thread with contact information
      let participantContacts: any[] = [];
      try {
        participantContacts = await enrichThreadWithContacts(
          threadId,
          tenantId,
          thread.participants || []
        );
        logger.info(`Enriched thread ${threadId} with ${participantContacts.length} participant contacts`);
      } catch (contactError: any) {
        logger.warn(`Failed to enrich thread with contacts: ${contactError.message}`);
        // Continue without contact data - not critical
      }

      const serializedThread = {
        ...thread,
        lastMessageAt: serializeTimestamp(thread.lastMessageAt),
        createdAt: serializeTimestamp(thread.createdAt),
        updatedAt: serializeTimestamp(thread.updatedAt),
        participantContacts, // Add contact information
      };

      logger.info(`Returning thread ${threadId} with ${serializedMessages.length} messages (source: ${messagesSource})`);

      response.status(200).json({
        success: true,
        thread: serializedThread,
        messages: serializedMessages,
      });
    } catch (error: any) {
      logger.error('Error in getEmailThreadApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/threads/:threadId/messages
 * 
 * Send a reply in an email thread.
 */
export const sendEmailReplyApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      // TODO: Add authentication
      const threadId = request.query.threadId as string;
      const {
        tenantId,
        userId,
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyPlain,
        attachments,
        senderIdentity, // 'gmail' | 'sendgrid'
      } = request.body;

      if (!threadId || !tenantId || !userId || !to || !subject || !bodyPlain) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId, tenantId, userId, to, subject, and bodyPlain are required' },
        });
        return;
      }

      // Parallel queries for better performance
      const [threadDoc, userDoc] = await Promise.all([
        db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .doc(threadId)
          .get(),
        db.collection('users').doc(userId).get(),
      ]);

      if (!threadDoc.exists) {
        response.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Thread not found' },
        });
        return;
      }

      const threadData = threadDoc.data() as EmailThread;
      const userData = userDoc.data();
      const fromEmail = userData?.email;

      // Get last message in thread for In-Reply-To header (can be done in parallel with email sending prep)
      const messagesQuery = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('emailThreads')
        .doc(threadId)
        .collection('messages')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();

      const lastMessage = messagesQuery.empty ? null : messagesQuery.docs[0].data() as EmailMessage;
      const inReplyToMessageId = lastMessage?.gmailMessageId || lastMessage?.providerMessageId;

      if (!fromEmail) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'User email not found' },
        });
        return;
      }

      // For individual emails (reply), always use Gmail
      // SendGrid is only for bulk/automated emails
      if (!userData?.gmailTokens?.access_token) {
        response.status(400).json({
          success: false,
          error: { 
            code: 'GMAIL_NOT_CONNECTED', 
            message: 'Gmail connection required for sending individual emails. Please connect your Gmail account in settings.' 
          },
        });
        return;
      }

      // Use Gmail provider for individual emails
      const emailProvider = getEmailProvider({
        id: `gmail_${userId}`,
        type: 'gmail',
        emailProvider: 'gmail',
        gmailUserId: userId,
        enabled: true,
      });

      // Prepare recipients
      const toEmails = Array.isArray(to) ? to : [to];
      const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
      const bccEmails = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

      // Send email
      const emailResult = await emailProvider.sendEmail({
        tenantId,
        to: toEmails.map(email => ({ email, name: email.split('@')[0] })),
        cc: ccEmails.length > 0 ? ccEmails.map(email => ({ email, name: email.split('@')[0] })) : undefined,
        bcc: bccEmails.length > 0 ? bccEmails.map(email => ({ email, name: email.split('@')[0] })) : undefined,
        subject,
        htmlBody: bodyHtml || bodyPlain,
        textBody: bodyPlain,
        fromEmail: userData?.email || fromEmail,
        fromName: userData?.displayName || userData?.firstName || 'HRX One',
        messageTypeId: 'direct_message',
        userId: toEmails[0], // First recipient
        gmailUserId: userId, // Always use Gmail for individual emails
        threadId: threadData.gmailThreadId, // For Gmail thread replies
        inReplyTo: inReplyToMessageId ? inReplyToMessageId : undefined, // For Gmail In-Reply-To header
        attachments: attachments || undefined,
      });

      if (!emailResult.success) {
        response.status(500).json({
          success: false,
          error: { code: 'EMAIL_SEND_FAILED', message: emailResult.errorMessage || 'Failed to send email' },
        });
        return;
      }

      // Add message to thread
      const messageId = await addMessageToThread(threadId, tenantId, {
        direction: 'outbound',
        from: fromEmail,
        fromUserId: userId,
        to: toEmails,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        bcc: bccEmails.length > 0 ? bccEmails : undefined,
        subject,
        bodyHtml,
        bodyPlain,
        bodySnippet: bodyPlain.substring(0, 200),
        attachments: attachments || [],
        status: emailResult.providerMessageId ? 'sent' : 'failed',
        providerMessageId: emailResult.providerMessageId,
        read: true, // Outbound messages are auto-read
      });

      // Collect all recipient emails (to, cc, bcc)
      const allRecipientEmails = [...toEmails, ...ccEmails, ...bccEmails];
      
      // Log to messageLogs for each recipient (users)
      try {
        for (const recipientEmail of toEmails) {
          // Try to find user by email
          const recipientQuery = await db.collection('users')
            .where('email', '==', recipientEmail)
            .limit(1)
            .get();
          
          const recipientUserId = recipientQuery.empty ? recipientEmail : recipientQuery.docs[0].id;
          
          await logMessage({
            userId: recipientUserId,
            tenantId,
            threadId,
            messageTypeId: 'direct_message',
            channel: 'email',
            direction: 'outbound',
            fromIdentity: 'recruiter',
            fromUserId: userId,
            contentOriginal: bodyHtml || bodyPlain,
            contentSent: bodyPlain,
            language: null,
            status: emailResult.providerMessageId ? 'sent' : 'failed',
            providerMessageId: emailResult.providerMessageId,
          });
        }
      } catch (logError) {
        logger.error('Failed to log email message:', logError);
      }

      // Find and log to CRM contacts (email_logs and activity_logs)
      try {
        const contactMap = await findContactsByEmails(tenantId, allRecipientEmails);
        const contactIds: string[] = [];
        
        for (const [email, contact] of contactMap.entries()) {
          contactIds.push(contact.id);
          
          // Find deal for this contact
          const dealId = await findContactDeal(tenantId, contact.id);
          
          // Create email_logs entry for CRM compatibility
          const emailLog = {
            messageId: emailResult.providerMessageId || `thread_${threadId}_${Date.now()}`,
            threadId: threadId,
            subject,
            from: fromEmail,
            to: toEmails,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            bcc: bccEmails.length > 0 ? bccEmails : undefined,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            bodySnippet: bodyPlain.substring(0, 250),
            bodyHtml,
            direction: 'sent',
            contactId: contact.id,
            companyId: contact.companyId || null,
            dealId: dealId || null,
            userId,
            isDraft: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('email_logs')
            .add(emailLog);
          
          // Create activity_logs entry for contact timeline
          const activityLog = {
            tenantId,
            entityType: 'contact',
            entityId: contact.id,
            activityType: 'email',
            title: `Email sent: ${subject}`,
            description: bodyPlain.substring(0, 200) + (bodyPlain.length > 200 ? '...' : ''),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId,
            userName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
            metadata: {
              emailSubject: subject,
              emailFrom: fromEmail,
              emailTo: toEmails,
              emailCc: ccEmails.length > 0 ? ccEmails : undefined,
              emailBcc: bccEmails.length > 0 ? bccEmails : undefined,
              direction: 'outbound',
              gmailMessageId: emailResult.providerMessageId,
              gmailThreadId: threadData.gmailThreadId,
              bodySnippet: bodyPlain.substring(0, 500),
              contactEmail: contact.email,
              contactName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
              threadId: threadId,
            },
            associations: {
              contacts: [contact.id],
              deals: dealId ? [dealId] : [],
              companies: contact.companyId ? [contact.companyId] : [],
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('activity_logs')
            .add(activityLog);
        }
        
        // Update thread with contact IDs for quick lookup
        if (contactIds.length > 0) {
          const threadRef = db.collection('tenants').doc(tenantId)
            .collection('emailThreads')
            .doc(threadId);
          
          const threadDoc = await threadRef.get();
          if (threadDoc.exists) {
            const existingContactIds = (threadDoc.data()?.participantContactIds || []) as string[];
            const updatedContactIds = Array.from(new Set([...existingContactIds, ...contactIds]));
            
            await threadRef.update({
              participantContactIds: updatedContactIds,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        }
      } catch (contactLogError) {
        logger.error('Failed to log email to contacts:', contactLogError);
        // Don't fail the request if contact logging fails
      }

      // Mark thread as read
      await markThreadRead(threadId, tenantId, userId);

      response.status(200).json({
        success: true,
        messageId,
        threadId,
        providerMessageId: emailResult.providerMessageId,
      });
    } catch (error: any) {
      logger.error('Error in sendEmailReplyApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/send
 * 
 * Send a new email (not a reply). Creates a new thread.
 */
export const sendNewEmailApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      const {
        tenantId,
        userId,
        to,
        cc,
        bcc,
        subject,
        bodyHtml,
        bodyPlain,
        attachments,
        senderIdentity, // 'gmail' | 'sendgrid'
      } = request.body;

      if (!tenantId || !userId || !to || !subject || !bodyPlain) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId, userId, to, subject, and bodyPlain are required' },
        });
        return;
      }

      // Get user's email
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();
      const fromEmail = userData?.email;

      if (!fromEmail) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'User email not found' },
        });
        return;
      }

      // For individual emails (forward, reply, compose), always use Gmail
      // SendGrid is only for bulk/automated emails
      if (!userData?.gmailTokens?.access_token) {
        response.status(400).json({
          success: false,
          error: { 
            code: 'GMAIL_NOT_CONNECTED', 
            message: 'Gmail connection required for sending individual emails. Please connect your Gmail account in settings.' 
          },
        });
        return;
      }

      // Use Gmail provider for individual emails
      const emailProvider = getEmailProvider({
        id: `gmail_${userId}`,
        type: 'gmail',
        emailProvider: 'gmail',
        gmailUserId: userId,
        enabled: true,
      });

      // Prepare recipients
      const toEmails = Array.isArray(to) ? to : [to];
      const ccEmails = cc ? (Array.isArray(cc) ? cc : [cc]) : [];
      const bccEmails = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : [];

      // Use the user's Gmail address for individual emails
      const resolvedFromEmail = userData?.email || fromEmail;
      const resolvedFromName = userData?.displayName || userData?.firstName || 'HRX One';

      // Send email (no threadId or inReplyTo for new emails)
      const emailResult = await emailProvider.sendEmail({
        tenantId,
        to: toEmails.map(email => ({ email, name: email.split('@')[0] })),
        cc: ccEmails.length > 0 ? ccEmails.map(email => ({ email, name: email.split('@')[0] })) : undefined,
        bcc: bccEmails.length > 0 ? bccEmails.map(email => ({ email, name: email.split('@')[0] })) : undefined,
        subject,
        htmlBody: bodyHtml || bodyPlain,
        textBody: bodyPlain,
        fromEmail: resolvedFromEmail, // undefined for SendGrid = use verified sender
        fromName: resolvedFromName,
        messageTypeId: 'direct_message',
        userId: toEmails[0], // First recipient
        gmailUserId: userId, // Always use Gmail for individual emails
        // No threadId or inReplyTo for new emails
        attachments: attachments || undefined,
      });

      if (!emailResult.success) {
        response.status(500).json({
          success: false,
          error: { code: 'EMAIL_SEND_FAILED', message: emailResult.errorMessage || 'Failed to send email' },
        });
        return;
      }

      // Create a new thread for this email
      // Note: For new emails, Gmail will create its own thread, but we don't have the threadId yet
      // The thread will be created without gmailThreadId initially
      const newThread = await findOrCreateEmailThread(
        tenantId,
        {
          subject,
          from: fromEmail,
          to: toEmails,
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          gmailLabelIds: [],
        },
        {
          userId,
        }
      );

      // Add message to the new thread
      const messageId = await addMessageToThread(newThread.id!, tenantId, {
        direction: 'outbound',
        from: fromEmail,
        fromUserId: userId,
        to: toEmails,
        cc: ccEmails.length > 0 ? ccEmails : undefined,
        bcc: bccEmails.length > 0 ? bccEmails : undefined,
        subject,
        bodyHtml,
        bodyPlain,
        bodySnippet: bodyPlain.substring(0, 200),
        attachments: attachments || [],
        status: emailResult.providerMessageId ? 'sent' : 'failed',
        providerMessageId: emailResult.providerMessageId,
        read: true, // Outbound messages are auto-read
      });

      // Collect all recipient emails (to, cc, bcc)
      const allRecipientEmails = [...toEmails, ...ccEmails, ...bccEmails];
      
      // Log to messageLogs for each recipient (users)
      try {
        for (const recipientEmail of toEmails) {
          // Try to find user by email
          const recipientQuery = await db.collection('users')
            .where('email', '==', recipientEmail)
            .limit(1)
            .get();
          
          const recipientUserId = recipientQuery.empty ? recipientEmail : recipientQuery.docs[0].id;
          
          await logMessage({
            userId: recipientUserId,
            tenantId,
            threadId: newThread.id!,
            messageTypeId: 'direct_message',
            channel: 'email',
            direction: 'outbound',
            fromIdentity: 'recruiter',
            fromUserId: userId,
            contentOriginal: bodyHtml || bodyPlain,
            contentSent: bodyPlain,
            language: null,
            status: emailResult.providerMessageId ? 'sent' : 'failed',
            providerMessageId: emailResult.providerMessageId,
          });
        }
      } catch (logError) {
        logger.error('Failed to log email message:', logError);
      }

      // Find and log to CRM contacts (email_logs and activity_logs)
      try {
        const contactMap = await findContactsByEmails(tenantId, allRecipientEmails);
        const contactIds: string[] = [];
        
        for (const [email, contact] of contactMap.entries()) {
          contactIds.push(contact.id);
          
          // Find deal for this contact
          const dealId = await findContactDeal(tenantId, contact.id);
          
          // Create email_logs entry for CRM compatibility
          const emailLog = {
            messageId: emailResult.providerMessageId || `thread_${newThread.id}_${Date.now()}`,
            threadId: newThread.id!,
            subject,
            from: fromEmail,
            to: toEmails,
            cc: ccEmails.length > 0 ? ccEmails : undefined,
            bcc: bccEmails.length > 0 ? bccEmails : undefined,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            bodySnippet: bodyPlain.substring(0, 250),
            bodyHtml,
            direction: 'sent',
            contactId: contact.id,
            companyId: contact.companyId || null,
            dealId: dealId || null,
            userId,
            isDraft: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('email_logs')
            .add(emailLog);
          
          // Create activity_logs entry for contact timeline
          const activityLog = {
            tenantId,
            entityType: 'contact',
            entityId: contact.id,
            activityType: 'email',
            title: `Email sent: ${subject}`,
            description: bodyPlain.substring(0, 200) + (bodyPlain.length > 200 ? '...' : ''),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId,
            userName: userData?.displayName || userData?.firstName || userData?.email || 'Unknown',
            metadata: {
              emailSubject: subject,
              emailFrom: fromEmail,
              emailTo: toEmails,
              emailCc: ccEmails.length > 0 ? ccEmails : undefined,
              emailBcc: bccEmails.length > 0 ? bccEmails : undefined,
              direction: 'outbound',
              gmailMessageId: emailResult.providerMessageId,
              gmailThreadId: newThread.gmailThreadId,
              bodySnippet: bodyPlain.substring(0, 500),
              contactEmail: contact.email,
              contactName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
              threadId: newThread.id!,
            },
            associations: {
              contacts: [contact.id],
              deals: dealId ? [dealId] : [],
              companies: contact.companyId ? [contact.companyId] : [],
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          
          await db.collection('tenants').doc(tenantId)
            .collection('activity_logs')
            .add(activityLog);
        }
        
        // Update thread with contact IDs for quick lookup
        if (contactIds.length > 0) {
          const threadRef = db.collection('tenants').doc(tenantId)
            .collection('emailThreads')
            .doc(newThread.id!);
          
          await threadRef.update({
            participantContactIds: contactIds,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (contactLogError) {
        logger.error('Failed to log email to contacts:', contactLogError);
        // Don't fail the request if contact logging fails
      }

      response.status(200).json({
        success: true,
        messageId,
        threadId: newThread.id!,
        providerMessageId: emailResult.providerMessageId,
      });
    } catch (error: any) {
      logger.error('Error in sendNewEmailApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * PATCH /api/email/threads/:threadId
 * 
 * Update thread (mark read, star, archive, etc.).
 */
export const updateEmailThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'PATCH') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only PATCH allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      const threadId = request.query.threadId as string;
      const { tenantId, userId, read, starred, status } = request.body;

      if (!threadId || !tenantId || !userId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId, tenantId, and userId are required' },
        });
        return;
      }

      const threadRef = db
        .collection('tenants')
        .doc(tenantId)
        .collection('emailThreads')
        .doc(threadId);

      const updates: any = {
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (read !== undefined) {
        if (read) {
          await markThreadRead(threadId, tenantId, userId);
        } else {
          // Mark as unread (would need to implement)
          updates.unreadCount = admin.firestore.FieldValue.increment(1);
        }
      }

      if (starred !== undefined) {
        updates.starred = starred;
      }

      if (status) {
        updates.status = status;
      }

      await threadRef.update(updates);

      response.status(200).json({
        success: true,
        threadId,
      });
    } catch (error: any) {
      logger.error('Error in updateEmailThreadApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/threads/:threadId/archive
 * 
 * Archive a thread.
 */
export const archiveEmailThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      // Parse threadId from multiple sources (body, query, or path)
      // Priority: 1) request body, 2) query params, 3) URL path
      let threadId = (request.body as any)?.threadId;
      
      if (!threadId) {
        threadId = request.query.threadId as string | undefined;
      }
      
      if (!threadId) {
        // Parse from URL path as last resort
        const urlPath = (request as any).path || ((request as any).url ? (request as any).url.split('?')[0] : '');
        const pathParts = urlPath.split('/').filter(Boolean);
        threadId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;
      }
      
      const { tenantId, userId } = request.body || {};

      if (!threadId || !tenantId || !userId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId, tenantId, and userId are required' },
        });
        return;
      }

      const { gmailThreadId } = await archiveThread(threadId, tenantId, userId);

      // Sync to Gmail if thread has Gmail thread ID
      if (gmailThreadId) {
        syncArchiveStateToGmail(userId, gmailThreadId, true).catch(err => {
          logger.error('Failed to sync archive to Gmail:', err);
        });
      }

      response.status(200).json({
        success: true,
        threadId,
      });
    } catch (error: any) {
      logger.error('Error in archiveEmailThreadApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/threads/:threadId/unarchive
 * 
 * Unarchive a thread (restore to active).
 */
export const unarchiveEmailThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      // Parse threadId from URL path (e.g., /unarchiveEmailThreadApi/{threadId})
      const urlPath = request.path || request.url.split('?')[0];
      const pathParts = urlPath.split('/').filter(Boolean);
      const threadId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;
      const { tenantId, userId } = request.body;

      if (!threadId || !tenantId || !userId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId, tenantId, and userId are required' },
        });
        return;
      }

      const { gmailThreadId } = await unarchiveThread(threadId, tenantId, userId);

      // Sync to Gmail if thread has Gmail thread ID
      if (gmailThreadId) {
        syncArchiveStateToGmail(userId, gmailThreadId, false).catch(err => {
          logger.error('Failed to sync unarchive to Gmail:', err);
        });
      }

      response.status(200).json({
        success: true,
        threadId,
      });
    } catch (error: any) {
      logger.error('Error in unarchiveEmailThreadApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/threads/:threadId/star
 * 
 * Star or unstar a thread.
 */
export const starEmailThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      // Parse threadId from multiple sources (body, query, or path)
      // Firebase Functions v2 doesn't automatically parse path parameters
      // Priority: 1) request body, 2) query params, 3) URL path
      let threadId = (request.body as any)?.threadId;
      
      if (!threadId) {
        threadId = request.query.threadId as string | undefined;
      }
      
      if (!threadId) {
        // Parse from URL path as last resort
        const urlPath = (request as any).path || ((request as any).url ? (request as any).url.split('?')[0] : '');
        const pathParts = urlPath.split('/').filter(Boolean);
        // The last part should be the threadId (e.g., ['starEmailThreadApi', 'v7KEEeLuWqmXMZZkgR4I'])
        threadId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null;
      }
      
      const { tenantId, starred } = request.body || {};

      logger.info('starEmailThreadApi called', { 
        threadId, 
        tenantId, 
        starred,
        hasBody: !!request.body,
        queryThreadId: request.query.threadId,
        path: (request as any).path,
        url: (request as any).url
      });

      if (!threadId || !tenantId || starred === undefined) {
        logger.warn('starEmailThreadApi: Missing required parameters', { threadId, tenantId, starred });
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId, tenantId, and starred are required' },
        });
        return;
      }

      await starThread(threadId, tenantId, starred === true);

      response.status(200).json({
        success: true,
        threadId,
        starred: starred === true,
      });
    } catch (error: any) {
      logger.error('Error in starEmailThreadApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/email/threads/bulk-update
 * 
 * Bulk update multiple threads (archive, star, delete, etc.).
 */
export const bulkUpdateEmailThreadsApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.set('Access-Control-Allow-Origin', '*');
      response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.status(204).send('');
      return;
    }

    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      response.set('Access-Control-Allow-Origin', '*');

      const { threadIds, tenantId, updates, userId } = request.body;

      if (!threadIds || !Array.isArray(threadIds) || threadIds.length === 0) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadIds array is required' },
        });
        return;
      }

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      if (!updates || Object.keys(updates).length === 0) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'updates object is required' },
        });
        return;
      }

      await bulkUpdateThreads(threadIds, tenantId, updates);

      // Sync to Gmail if archiving/unarchiving
      if (updates.status === 'archived' && userId) {
        // Get Gmail thread IDs for all threads
        const threadsSnapshot = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .where(admin.firestore.FieldPath.documentId(), 'in', threadIds)
          .get();

        for (const threadDoc of threadsSnapshot.docs) {
          const threadData = threadDoc.data() as EmailThread;
          if (threadData.gmailThreadId) {
            syncArchiveStateToGmail(userId, threadData.gmailThreadId, true).catch(err => {
              logger.error('Failed to sync bulk archive to Gmail:', err);
            });
          }
        }
      } else if (updates.status === 'active' && userId) {
        // Unarchiving
        const threadsSnapshot = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('emailThreads')
          .where(admin.firestore.FieldPath.documentId(), 'in', threadIds)
          .get();

        for (const threadDoc of threadsSnapshot.docs) {
          const threadData = threadDoc.data() as EmailThread;
          if (threadData.gmailThreadId) {
            syncArchiveStateToGmail(userId, threadData.gmailThreadId, false).catch(err => {
              logger.error('Failed to sync bulk unarchive to Gmail:', err);
            });
          }
        }
      }

      response.status(200).json({
        success: true,
        updatedCount: threadIds.length,
      });
    } catch (error: any) {
      logger.error('Error in bulkUpdateEmailThreadsApi:', error);
      response.set('Access-Control-Allow-Origin', '*');
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

