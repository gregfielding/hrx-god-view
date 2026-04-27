/**
 * Messaging Analytics API
 * 
 * Exposes insights from messageLogs and consent events for dashboards.
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 4 Messaging Dashboards
 */

import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * GET /api/messaging/analytics/summary
 * 
 * Returns summary metrics for messaging dashboard
 */
export const getMessagingSummary = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      const { tenantId, startDate, endDate } = request.query;

      if (!tenantId || typeof tenantId !== 'string') {
        response.status(400).json({ error: 'tenantId is required' });
        return;
      }

      const start = startDate ? admin.firestore.Timestamp.fromDate(new Date(startDate as string)) : 
                   admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days
      const end = endDate ? admin.firestore.Timestamp.fromDate(new Date(endDate as string)) : 
                 admin.firestore.Timestamp.now();

      // Get all message logs in date range
      const logsQuery = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageLogs')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get();

      const logs = logsQuery.docs.map(doc => doc.data());

      // Calculate metrics
      const totalMessages = logs.length;
      const byChannel = {
        sms: logs.filter(l => l.channel === 'sms').length,
        email: logs.filter(l => l.channel === 'email').length,
        push: logs.filter(l => l.channel === 'push').length,
      };

      const byStatus = {
        sent: logs.filter(l => l.status === 'sent').length,
        delivered: logs.filter(l => l.status === 'delivered').length,
        failed: logs.filter(l => l.status === 'failed').length,
        suppressed_rate_limit: logs.filter(l => l.status === 'suppressed_rate_limit').length,
        suppressed_quiet_hours: logs.filter(l => l.status === 'suppressed_quiet_hours').length,
      };

      // Get STOP events (preference changes)
      // Note: preferenceChangeLogs are stored under /users/{userId}/preferenceChangeLogs
      // For tenant-wide analytics, we'd need to query all users in the tenant
      // For now, we'll use a collectionGroup query to find all preference changes
      const stopEventsQuery = await db
        .collectionGroup('preferenceChangeLogs')
        .where('tenantId', '==', tenantId)
        .where('preferenceType', '==', 'smsBlockedSystem')
        .where('newValue', '==', true)
        .where('timestamp', '>=', start)
        .where('timestamp', '<=', end)
        .get();

      const stopEvents = stopEventsQuery.docs.length;

      // Top message types by volume
      const messageTypeCounts: Record<string, number> = {};
      logs.forEach(log => {
        const type = log.messageTypeId || 'unknown';
        messageTypeCounts[type] = (messageTypeCounts[type] || 0) + 1;
      });

      const topMessageTypes = Object.entries(messageTypeCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([type, count]) => ({ type, count }));

      // Top message types by failure rate
      const failureRates = Object.entries(messageTypeCounts).map(([type, total]) => {
        const failed = logs.filter(l => l.messageTypeId === type && l.status === 'failed').length;
        return {
          type,
          total,
          failed,
          failureRate: total > 0 ? (failed / total) * 100 : 0,
        };
      }).sort((a, b) => b.failureRate - a.failureRate).slice(0, 10);

      response.json({
        summary: {
          totalMessages,
          byChannel,
          byStatus,
          stopEvents,
        },
        topMessageTypes,
        topFailureRates: failureRates,
        dateRange: {
          start: start.toDate().toISOString(),
          end: end.toDate().toISOString(),
        },
      });
    } catch (error: any) {
      logger.error('Error getting messaging summary:', error);
      response.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/messaging/analytics/user/:userId
 * 
 * Returns message history for a specific user
 */
export const getUserMessageHistory = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      const { tenantId, userId } = request.query;

      if (!tenantId || typeof tenantId !== 'string') {
        response.status(400).json({ error: 'tenantId is required' });
        return;
      }

      if (!userId || typeof userId !== 'string') {
        response.status(400).json({ error: 'userId is required' });
        return;
      }

      const limit = parseInt(request.query.limit as string) || 100;
      const startAfterDocId = request.query.startAfter as string | undefined;

      // Build query
      let logsQuery = db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageLogs')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      // Use cursor-based pagination if startAfter is provided
      if (startAfterDocId) {
        const startAfterDoc = await db
          .collection('tenants')
          .doc(tenantId)
          .collection('messageLogs')
          .doc(startAfterDocId)
          .get();
        if (startAfterDoc.exists) {
          logsQuery = logsQuery.startAfter(startAfterDoc);
        }
      }

      const logsSnapshot = await logsQuery.get();

      const messages = logsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
      }));

      response.json({
        messages,
        total: messages.length,
        limit,
        hasMore: logsSnapshot.docs.length === limit,
        lastDocId: logsSnapshot.docs.length > 0 ? logsSnapshot.docs[logsSnapshot.docs.length - 1].id : null,
      });
    } catch (error: any) {
      logger.error('Error getting user message history:', error);
      
      // Extract error message and details
      const errorMessage = error?.message || String(error || 'Unknown error');
      const errorCode = error?.code;
      const errorDetails = error?.details || errorMessage;
      
      // Check if it's an index error (code 9 is FAILED_PRECONDITION for Firestore)
      const isIndexError = errorCode === 9 || 
                          errorMessage?.includes('index') || 
                          errorMessage?.includes('FAILED_PRECONDITION') ||
                          errorDetails?.includes('index');
      
      if (isIndexError) {
        const isBuilding = errorMessage?.includes('currently building') || 
                          errorDetails?.includes('currently building') ||
                          errorMessage?.includes('cannot be used yet');
        
        if (isBuilding) {
          logger.warn('Firestore index is still building. Query will work once index is ready.');
          response.status(503).json({ 
            error: 'Database index is building. Please try again in a few minutes.',
            code: 'INDEX_BUILDING',
            retryAfter: 60
          });
          return;
        } else {
          logger.error('Missing Firestore index. Please create a composite index for messageLogs: userId (Ascending), createdAt (Descending)');
          response.status(500).json({ 
            error: 'Missing database index. Please contact support.',
            code: 'MISSING_INDEX',
            details: errorMessage
          });
          return;
        }
      }
      
      // Generic error response
      response.status(500).json({ 
        error: 'Failed to load message history',
        message: errorMessage
      });
    }
  }
);

/**
 * GET /api/messaging/analytics/optouts
 * 
 * Returns opt-out events and compliance data
 */
export const getOptOuts = onRequest(
  {
    cors: true,
  },
  async (request, response) => {
    try {
      const { tenantId, startDate, endDate } = request.query;

      if (!tenantId || typeof tenantId !== 'string') {
        response.status(400).json({ error: 'tenantId is required' });
        return;
      }

      const start = startDate ? admin.firestore.Timestamp.fromDate(new Date(startDate as string)) : 
                   admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? admin.firestore.Timestamp.fromDate(new Date(endDate as string)) : 
                 admin.firestore.Timestamp.now();

      // Get STOP events
      // Note: preferenceChangeLogs are stored under /users/{userId}/preferenceChangeLogs
      const stopEventsQuery = await db
        .collectionGroup('preferenceChangeLogs')
        .where('tenantId', '==', tenantId)
        .where('preferenceType', '==', 'smsBlockedSystem')
        .where('newValue', '==', true)
        .where('timestamp', '>=', start)
        .where('timestamp', '<=', end)
        .orderBy('timestamp', 'desc')
        .get();

      const stopEvents = stopEventsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString(),
      }));

      // Get suppressed messages
      const suppressedQuery = await db
        .collection('tenants')
        .doc(tenantId)
        .collection('messageLogs')
        .where('status', 'in', ['suppressed_rate_limit', 'suppressed_quiet_hours'])
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .orderBy('createdAt', 'desc')
        .get();

      const suppressed = suppressedQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString(),
      }));

      response.json({
        stopEvents,
        suppressed,
        dateRange: {
          start: start.toDate().toISOString(),
          end: end.toDate().toISOString(),
        },
      });
    } catch (error: any) {
      logger.error('Error getting opt-outs:', error);
      response.status(500).json({ error: error.message });
    }
  }
);

