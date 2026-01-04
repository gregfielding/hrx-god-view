/**
 * Slack Traffic Logging
 * 
 * Phase 5: Audit trail for Slack ↔ HRX message traffic
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export type SlackTrafficDirection = 'inbound' | 'outbound';
export type SlackTrafficType = 'message' | 'error' | 'warning';
export type SlackTrafficSource = 'slackEvents' | 'sendMessageToSlack';

export interface SlackTrafficLog {
  tenantId: string;

  direction: SlackTrafficDirection;
  type: SlackTrafficType;
  source: SlackTrafficSource;

  teamId?: string;
  channelId?: string;
  slackUserId?: string;

  internalConversationId?: string;
  internalMessageId?: string;

  ts: admin.firestore.Timestamp; // When HRX processed this event

  // Slack-specific
  slackTs?: string;        // Slack message ts
  slackThreadTs?: string;  // Slack thread_ts, if any

  // Status / reason
  status?: 'ok' | 'skipped' | 'failed';
  reason?: string;         // Short explanation for skipped/failed
}

/**
 * Log Slack traffic event
 * 
 * Lightweight logging - stores references and short strings, not full payloads
 */
export async function logSlackTraffic(log: SlackTrafficLog): Promise<void> {
  try {
    const logRef = db
      .collection('tenants')
      .doc(log.tenantId)
      .collection('slackLogs')
      .doc();

    await logRef.set({
      ...log,
      ts: log.ts || admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.debug('Slack traffic logged', {
      tenantId: log.tenantId,
      direction: log.direction,
      type: log.type,
      status: log.status,
    });
  } catch (error: any) {
    // Don't throw - logging failures shouldn't break message processing
    logger.error('Error logging Slack traffic', {
      error: error.message,
      tenantId: log.tenantId,
    });
  }
}



