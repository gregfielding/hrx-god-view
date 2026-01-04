/**
 * Admin Logging & Debugging API
 * 
 * Admin-only endpoints for viewing message logs and consent history.
 * 
 * Implements: HRX One Messaging API Spec — Section 7 Logging & Debugging APIs
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { getTenantMessageLogs, getUserMessageLogs } from './messageLogging';
import { Channel } from './messageTypesRegistry';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * GET /api/admin/messaging/logs
 * 
 * Search or list MessageLog entries.
 * 
 * Implements: HRX Messaging API Spec §7.1
 */
export const listMessageLogsApi = onRequest(
  {
    cors: true,
    // TODO: Add admin-only authentication
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Verify admin permissions

      const {
        tenantId,
        userId,
        messageTypeId,
        channel,
        direction,
        status,
        since,
        until,
        page = 1,
        pageSize = 50,
      } = request.query;

      if (!tenantId && !userId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'tenantId or userId is required' },
        });
        return;
      }

      let logs: any[] = [];

      if (userId) {
        // Get user-specific logs
        const startDate = since ? admin.firestore.Timestamp.fromDate(new Date(since as string)) : undefined;
        const endDate = until ? admin.firestore.Timestamp.fromDate(new Date(until as string)) : undefined;

        logs = await getUserMessageLogs(userId as string, {
          limit: Number(pageSize),
          channel: channel as Channel | undefined,
          messageTypeId: messageTypeId as string | undefined,
          direction: direction as 'inbound' | 'outbound' | undefined,
        });
      } else if (tenantId) {
        // Get tenant logs
        const startDate = since ? admin.firestore.Timestamp.fromDate(new Date(since as string)) : undefined;
        const endDate = until ? admin.firestore.Timestamp.fromDate(new Date(until as string)) : undefined;

        logs = await getTenantMessageLogs(tenantId as string, {
          limit: Number(pageSize),
          channel: channel as Channel | undefined,
          messageTypeId: messageTypeId as string | undefined,
          status: status as any,
          startDate,
          endDate,
        });
      }

      // Filter by status if provided
      if (status && !tenantId) {
        logs = logs.filter(log => log.status === status);
      }

      // Pagination
      const startIndex = (Number(page) - 1) * Number(pageSize);
      const endIndex = startIndex + Number(pageSize);
      const paginatedLogs = logs.slice(startIndex, endIndex);

      // Convert to DTO format
      const logDTOs = paginatedLogs.map(log => ({
        id: log.id,
        userId: log.userId,
        messageTypeId: log.messageTypeId,
        channel: log.channel,
        direction: log.direction,
        body: log.contentSent, // Map contentSent to body for API response
        language: log.language,
        status: log.status,
        createdAt: log.createdAt instanceof admin.firestore.Timestamp
          ? log.createdAt.toDate().toISOString()
          : new Date().toISOString(),
      }));

      response.status(200).json({
        success: true,
        data: logDTOs,
        page: Number(page),
        pageSize: Number(pageSize),
        total: logs.length,
      });
    } catch (error: any) {
      logger.error('Error in listMessageLogsApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

/**
 * GET /api/admin/messaging/consent-history/:userId
 * 
 * See SMS consent changes for a given user.
 * 
 * Implements: HRX Messaging API Spec §7.2
 */
export const getConsentHistoryApi = onRequest(
  {
    cors: true,
    // TODO: Add admin-only authentication
  },
  async (request, response) => {
    try {
      if (request.method !== 'GET') {
        response.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET allowed' } });
        return;
      }

      // TODO: Verify admin permissions

      const { userId } = request.query;

      if (!userId) {
        response.status(400).json({
          success: false,
          error: { code: 'INVALID_ARGUMENT', message: 'userId is required' },
        });
        return;
      }

      // Get consent history from preference change logs
      const consentHistorySnapshot = await db
        .collection('users')
        .doc(userId as string)
        .collection('preferenceChangeLogs')
        .where('preferenceType', 'in', ['smsOptIn', 'smsBlockedSystem'])
        .orderBy('timestamp', 'desc')
        .get();

      const consentHistory = consentHistorySnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          agreed: data.preferenceType === 'smsOptIn' ? data.newValue : !data.newValue,
          source: data.source,
          timestamp: data.timestamp instanceof admin.firestore.Timestamp
            ? data.timestamp.toDate().toISOString()
            : new Date().toISOString(),
          termsVersion: data.reason?.includes('version') ? '2025-01-27' : undefined, // Extract from reason if available
          note: data.reason,
        };
      });

      response.status(200).json({
        success: true,
        data: consentHistory,
      });
    } catch (error: any) {
      logger.error('Error in getConsentHistoryApi:', error);
      response.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: error.message || 'Unknown error' },
      });
    }
  }
);

