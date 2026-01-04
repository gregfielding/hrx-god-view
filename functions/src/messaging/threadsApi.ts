/**
 * Two-Way Messaging API Routes
 * 
 * Thread and message management for recruiter ↔ candidate SMS conversations.
 * 
 * Implements: HRX One Messaging API Spec — Section 3 Two-Way Messaging
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  getThreadWithMessages,
  getRecruiterThreads,
  sendOutboundMessage,
  findOrCreateThread,
  SmsThread,
  ThreadStatus,
} from './twoWayMessaging';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * GET /api/messaging/threads
 * 
 * List SMS threads for a recruiter (inbox view).
 * 
 * Implements: HRX Messaging API Spec §3.1
 */
export const listThreadsApi = onRequest(
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

      // Set CORS headers
      response.set('Access-Control-Allow-Origin', '*');

      // TODO: Add authentication
      // const recruiterId = request.auth?.uid;
      const recruiterId = request.query.recruiterId as string | undefined;
      const candidateId = request.query.candidateId as string | undefined;

      const {
        tenantId,
        status,
        assignedToMeOnly = 'true',
        search,
        page = 1,
        pageSize = 20,
        limit,
      } = request.query;

      if (!tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId is required' },
        });
        return;
      }

      let threads: SmsThread[] = [];

      // Support both recruiter and candidate queries
      if (candidateId) {
        // Query threads for a candidate (user inbox)
        // Note: If status filter is needed, it requires a composite index
        // For now, we'll filter in memory to avoid index requirements
        let threadsQuery: admin.firestore.Query = db
          .collection('tenants')
          .doc(tenantId as string)
          .collection('smsThreads')
          .where('candidateUserId', '==', candidateId)
          .orderBy('lastMessageAt', 'desc');

        const limitValue = limit ? Number(limit) : (Number(pageSize) * 2);
        threadsQuery = threadsQuery.limit(limitValue);

        const snapshot = await threadsQuery.get();
        threads = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as SmsThread[];

        // Filter by status in memory if provided (avoids composite index requirement)
        if (status) {
          threads = threads.filter(t => t.status === status);
        }
      } else if (recruiterId) {
        // Query threads for a recruiter (original behavior)
        threads = await getRecruiterThreads(
          recruiterId,
          tenantId as string,
          {
            status: status as ThreadStatus | undefined,
            limit: Number(pageSize) * 2, // Get more for filtering
          }
        );

        // Filter by assignedToMeOnly if needed
        if (assignedToMeOnly === 'true') {
          threads = threads.filter(t => t.primaryRecruiterUserId === recruiterId);
        }
      } else {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'Either recruiterId or candidateId is required' },
        });
        return;
      }

      let filteredThreads = threads;

      // Search filter (simplified - would need candidate lookup in production)
      if (search) {
        // TODO: Implement search by candidate name/phone
      }

      // Pagination (only for recruiter view, candidate view uses limit parameter)
      let paginatedThreads = filteredThreads;
      if (recruiterId && !candidateId) {
        const startIndex = (Number(page) - 1) * Number(pageSize);
        const endIndex = startIndex + Number(pageSize);
        paginatedThreads = filteredThreads.slice(startIndex, endIndex);
      }

      // Enrich with candidate data
      const enrichedThreads = await Promise.all(
        paginatedThreads.map(async (thread) => {
          try {
            const candidateDoc = await db.collection('users').doc(thread.candidateUserId).get();
            const candidateData = candidateDoc.data();

            // Get last message
            const { messages } = await getThreadWithMessages(thread.id!, { limit: 1 });
            const lastMessage = messages[0];

            // Mask phone number
            const phone = thread.candidatePhone;
            const maskedPhone = phone ? `${phone.slice(0, 5)}***${phone.slice(-4)}` : '';

            return {
              id: thread.id,
              candidateId: thread.candidateUserId,
              candidateName: candidateData?.displayName || candidateData?.firstName || 'Unknown',
              candidatePhoneMasked: maskedPhone,
              primaryRecruiterId: thread.primaryRecruiterUserId,
              lastMessageSnippet: lastMessage?.body?.substring(0, 100) || thread.lastMessageSnippet || '',
              lastMessageAt: thread.lastMessageAt instanceof admin.firestore.Timestamp
                ? thread.lastMessageAt.toDate().toISOString()
                : new Date().toISOString(),
              status: thread.status,
              unreadCount: thread.unreadCountForRecruiter || 0,
            };
          } catch (error: any) {
            logger.error(`Error enriching thread ${thread.id}:`, error);
            return null;
          }
        })
      );

      const validThreads = enrichedThreads.filter(t => t !== null);

      response.status(200).json({
        success: true,
        threads: validThreads, // Changed from 'data' to 'threads' for consistency
        page: Number(page),
        pageSize: Number(pageSize),
        total: filteredThreads.length,
      });
    } catch (error: any) {
      logger.error('Error in listThreadsApi:', error);
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
 * GET /api/messaging/threads/:threadId
 * 
 * Fetch full details and recent messages for a thread.
 * 
 * Implements: HRX Messaging API Spec §3.2
 */
export const getThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Add authentication

      const { threadId, limit = 50, before } = request.query;

      if (!threadId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId is required' },
        });
        return;
      }

      const { thread, messages } = await getThreadWithMessages(threadId as string, {
        limit: Number(limit),
      });

      // Enrich thread with candidate data
      const candidateDoc = await db.collection('users').doc(thread.candidateUserId).get();
      const candidateData = candidateDoc.data();

      const threadDetails = {
        id: thread.id,
        candidateId: thread.candidateUserId,
        candidateName: candidateData?.displayName || candidateData?.firstName || 'Unknown',
        candidatePhoneMasked: thread.candidatePhone ? `${thread.candidatePhone.slice(0, 5)}***${thread.candidatePhone.slice(-4)}` : '',
        primaryRecruiterId: thread.primaryRecruiterUserId,
        twilioNumber: thread.twilioNumber,
        status: thread.status,
        lastMessageAt: thread.lastMessageAt instanceof admin.firestore.Timestamp
          ? thread.lastMessageAt.toDate().toISOString()
          : new Date().toISOString(),
      };

      // Convert messages to DTO format
      const messageDTOs = messages.map(msg => ({
        id: msg.id,
        threadId: msg.threadId,
        direction: msg.direction,
        fromType: msg.fromType,
        fromUserId: msg.fromUserId,
        body: msg.body,
        language: msg.language,
        status: msg.status,
        createdAt: msg.createdAt instanceof admin.firestore.Timestamp
          ? msg.createdAt.toDate().toISOString()
          : new Date().toISOString(),
      }));

      response.status(200).json({
        success: true,
        thread: threadDetails,
        messages: messageDTOs,
      });
    } catch (error: any) {
      logger.error('Error in getThreadApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/threads/:threadId/messages
 * 
 * Send a recruiter message in an existing thread.
 * 
 * Implements: HRX Messaging API Spec §3.3
 */
export const sendThreadMessageApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication
      // const recruiterId = request.auth?.uid;
      const recruiterId = request.body.recruiterId || request.query.recruiterId as string; // Placeholder

      const { threadId } = request.query;
      const { body, fromUserId } = request.body;

      if (!threadId || !body) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'threadId and body are required' },
        });
        return;
      }

      const actualFromUserId = fromUserId || recruiterId;

      try {
        const result = await sendOutboundMessage(threadId as string, actualFromUserId, body);

        if (!result.success) {
          response.status(200).json({
            success: false,
            warning: 'Message failed to send',
          });
          return;
        }

        // Get the created message
        const { messages } = await getThreadWithMessages(threadId as string, { limit: 1 });
        const message = messages[0];

        const messageDTO = {
          id: message.id,
          threadId: message.threadId,
          direction: message.direction,
          fromType: message.fromType,
          fromUserId: message.fromUserId,
          body: message.body,
          language: message.language,
          status: message.status,
          createdAt: message.createdAt instanceof admin.firestore.Timestamp
            ? message.createdAt.toDate().toISOString()
            : new Date().toISOString(),
        };

        response.status(200).json({
          success: true,
          message: messageDTO,
        });
      } catch (error: any) {
        // Check if it's an opt-out error
        if (error.message?.includes('opted out') || error.message?.includes('blocked')) {
          response.status(200).json({
            success: false,
            warning: 'SMS blocked due to STOP keyword or opt-out',
          });
          return;
        }
        throw error;
      }
    } catch (error: any) {
      logger.error('Error in sendThreadMessageApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * POST /api/messaging/threads
 * 
 * Create a new thread manually (e.g., recruiter starting 1st contact).
 * 
 * Implements: HRX Messaging API Spec §3.4
 */
export const createThreadApi = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      if (request.method !== 'POST') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' } });
        return;
      }

      // TODO: Add authentication
      // const recruiterId = request.auth?.uid;
      const recruiterId = request.body.recruiterId as string; // Placeholder

      const {
        candidateId,
        candidatePhone,
        twilioNumber,
        tenantId,
        initialMessageBody,
        jobOrderId,
        applicationId,
      } = request.body;

      if (!candidateId || !candidatePhone || !twilioNumber || !tenantId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'candidateId, candidatePhone, twilioNumber, and tenantId are required' },
        });
        return;
      }

      // Create or find thread
      const thread = await findOrCreateThread(candidateId, candidatePhone, twilioNumber, tenantId, {
        primaryRecruiterId: recruiterId,
        jobOrderId,
        applicationId,
      });

      let firstMessage = null;

      // Send initial message if provided
      if (initialMessageBody && thread.id) {
        try {
          const result = await sendOutboundMessage(thread.id, recruiterId, initialMessageBody);
          if (result.success) {
            const { messages } = await getThreadWithMessages(thread.id, { limit: 1 });
            firstMessage = messages[0];
          }
        } catch (error: any) {
          logger.warn(`Failed to send initial message in thread ${thread.id}:`, error);
          // Continue even if initial message fails
        }
      }

      // Enrich thread details
      const candidateDoc = await db.collection('users').doc(candidateId).get();
      const candidateData = candidateDoc.data();

      const threadDetails = {
        id: thread.id,
        candidateId: thread.candidateUserId,
        candidateName: candidateData?.displayName || candidateData?.firstName || 'Unknown',
        candidatePhoneMasked: thread.candidatePhone ? `${thread.candidatePhone.slice(0, 5)}***${thread.candidatePhone.slice(-4)}` : '',
        primaryRecruiterId: thread.primaryRecruiterUserId,
        twilioNumber: thread.twilioNumber,
        status: thread.status,
        lastMessageAt: thread.lastMessageAt instanceof admin.firestore.Timestamp
          ? thread.lastMessageAt.toDate().toISOString()
          : new Date().toISOString(),
      };

      const firstMessageDTO = firstMessage ? {
        id: firstMessage.id,
        threadId: firstMessage.threadId,
        direction: firstMessage.direction,
        fromType: firstMessage.fromType,
        fromUserId: firstMessage.fromUserId,
        body: firstMessage.body,
        language: firstMessage.language,
        status: firstMessage.status,
        createdAt: firstMessage.createdAt instanceof admin.firestore.Timestamp
          ? firstMessage.createdAt.toDate().toISOString()
          : new Date().toISOString(),
      } : undefined;

      response.status(200).json({
        success: true,
        thread: threadDetails,
        firstMessage: firstMessageDTO,
      });
    } catch (error: any) {
      logger.error('Error in createThreadApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

