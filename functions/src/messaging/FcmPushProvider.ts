/**
 * FCM Push Provider Implementation
 * 
 * Firebase Cloud Messaging implementation for push notifications.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 2.2 FCM/Expo PushProvider Implementation
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import {
  PushProvider,
  PushSendParams,
  PushSendResult,
} from './PushProvider';

export class FcmPushProvider implements PushProvider {
  async sendPush(params: PushSendParams): Promise<PushSendResult> {
    let sentCount = 0;
    let failedCount = 0;
    const errors: PushSendResult['errors'] = [];

    for (const target of params.targets) {
      for (const token of target.deviceTokens) {
        try {
          await admin.messaging().send({
            token,
            notification: {
              title: params.title,
              body: params.body,
            },
            data: {
              ...params.data,
              tenantId: params.tenantId,
              messageTypeId: params.messageTypeId,
              userId: target.userId,
            },
          });
          sentCount += 1;
        } catch (err: any) {
          failedCount += 1;
          const errorCode = err?.code || 'FCM_ERROR';
          const errorMessage = err?.message || 'Unknown FCM error';
          
          logger.warn(`FCM push failed for token ${token.substring(0, 20)}...: ${errorMessage}`);
          
          errors.push({
            deviceToken: token,
            errorCode,
            errorMessage,
          });
        }
      }
    }

    logger.info(`FCM push: ${sentCount} sent, ${failedCount} failed for ${params.messageTypeId}`);

    return {
      success: failedCount === 0,
      sentCount,
      failedCount,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}

