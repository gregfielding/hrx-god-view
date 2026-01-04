/**
 * Rate Limiting & Abuse Protection
 * 
 * Prevents accidental spam, runaway loops, and over-messaging users.
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 1 Rate Limiting & Abuse Protection
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export type Channel = 'sms' | 'email' | 'push';

export interface RateLimitConfig {
  defaults: {
    perUser: {
      smsHourly: number;
      smsDaily: number;
      emailDaily: number;
      pushDaily: number;
    };
    perTenantHourly: {
      sms: number;
      email: number;
      push: number;
    };
  };
  overridesPerMessageType?: {
    [messageTypeId: string]: {
      smsHourlyPerUser?: number;
      smsDailyPerUser?: number;
      emailDailyPerUser?: number;
      pushDailyPerUser?: number;
    };
  };
  updatedAt?: admin.firestore.Timestamp;
}

export interface RateLimitCheckArgs {
  tenantId: string;
  userId: string;
  messageTypeId: string;
  channel: Channel;
}

export type RateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'USER_LIMIT' | 'TENANT_LIMIT';
      details: {
        limitType: string;
        limitValue: number;
        currentCount: number;
        window: string;
      };
    };

/**
 * Default rate limit configuration
 */
const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  defaults: {
    perUser: {
      smsHourly: 6,
      smsDaily: 20,
      emailDaily: 20,
      pushDaily: 30,
    },
    perTenantHourly: {
      sms: 3000,
      email: 10000,
      push: 10000,
    },
  },
};

/**
 * Get tenant rate limit configuration
 */
async function getRateLimitConfig(tenantId: string): Promise<RateLimitConfig> {
  try {
    const configDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messagingConfig')
      .doc('systemLimits')
      .get();

    if (configDoc.exists) {
      return configDoc.data() as RateLimitConfig;
    }

    return DEFAULT_RATE_LIMITS;
  } catch (error: any) {
    logger.error(`Error fetching rate limit config for tenant ${tenantId}:`, error);
    return DEFAULT_RATE_LIMITS;
  }
}

/**
 * Count messages sent to a user in a time window
 */
async function countUserMessages(
  tenantId: string,
  userId: string,
  channel: Channel,
  windowStart: admin.firestore.Timestamp,
  windowEnd: admin.firestore.Timestamp
): Promise<number> {
  try {
    const logsQuery = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .where('userId', '==', userId)
      .where('channel', '==', channel)
      .where('direction', '==', 'outbound')
      .where('createdAt', '>=', windowStart)
      .where('createdAt', '<=', windowEnd)
      .where('status', 'in', ['sent', 'queued', 'delivered'])
      .count()
      .get();

    return logsQuery.data().count;
  } catch (error: any) {
    logger.error(`Error counting user messages:`, error);
    return 0;
  }
}

/**
 * Count messages sent by tenant in a time window
 */
async function countTenantMessages(
  tenantId: string,
  channel: Channel,
  windowStart: admin.firestore.Timestamp,
  windowEnd: admin.firestore.Timestamp
): Promise<number> {
  try {
    const logsQuery = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageLogs')
      .where('channel', '==', channel)
      .where('direction', '==', 'outbound')
      .where('createdAt', '>=', windowStart)
      .where('createdAt', '<=', windowEnd)
      .where('status', 'in', ['sent', 'queued', 'delivered'])
      .count()
      .get();

    return logsQuery.data().count;
  } catch (error: any) {
    logger.error(`Error counting tenant messages:`, error);
    return 0;
  }
}

/**
 * Check rate limits for a message send attempt
 * 
 * Implements: HRX One Messaging Phase 5 Spec — Section 1.3 Implementation Location
 */
export async function checkRateLimits(
  args: RateLimitCheckArgs
): Promise<RateLimitResult> {
  const { tenantId, userId, messageTypeId, channel } = args;

  try {
    const config = await getRateLimitConfig(tenantId);
    const now = admin.firestore.Timestamp.now();
    const oneHourAgo = admin.firestore.Timestamp.fromMillis(
      now.toMillis() - 60 * 60 * 1000
    );
    const oneDayAgo = admin.firestore.Timestamp.fromMillis(
      now.toMillis() - 24 * 60 * 60 * 1000
    );

    // Check per-user limits
    const messageTypeOverride = config.overridesPerMessageType?.[messageTypeId];
    
    if (channel === 'sms') {
      // Check hourly limit
      const hourlyLimit =
        messageTypeOverride?.smsHourlyPerUser ?? config.defaults.perUser.smsHourly;
      const hourlyCount = await countUserMessages(
        tenantId,
        userId,
        channel,
        oneHourAgo,
        now
      );

      if (hourlyCount >= hourlyLimit) {
        return {
          allowed: false,
          reason: 'USER_LIMIT',
          details: {
            limitType: 'smsHourly',
            limitValue: hourlyLimit,
            currentCount: hourlyCount,
            window: '1 hour',
          },
        };
      }

      // Check daily limit
      const dailyLimit =
        messageTypeOverride?.smsDailyPerUser ?? config.defaults.perUser.smsDaily;
      const dailyCount = await countUserMessages(
        tenantId,
        userId,
        channel,
        oneDayAgo,
        now
      );

      if (dailyCount >= dailyLimit) {
        return {
          allowed: false,
          reason: 'USER_LIMIT',
          details: {
            limitType: 'smsDaily',
            limitValue: dailyLimit,
            currentCount: dailyCount,
            window: '24 hours',
          },
        };
      }
    } else if (channel === 'email') {
      const dailyLimit =
        messageTypeOverride?.emailDailyPerUser ?? config.defaults.perUser.emailDaily;
      const dailyCount = await countUserMessages(
        tenantId,
        userId,
        channel,
        oneDayAgo,
        now
      );

      if (dailyCount >= dailyLimit) {
        return {
          allowed: false,
          reason: 'USER_LIMIT',
          details: {
            limitType: 'emailDaily',
            limitValue: dailyLimit,
            currentCount: dailyCount,
            window: '24 hours',
          },
        };
      }
    } else if (channel === 'push') {
      const dailyLimit =
        messageTypeOverride?.pushDailyPerUser ?? config.defaults.perUser.pushDaily;
      const dailyCount = await countUserMessages(
        tenantId,
        userId,
        channel,
        oneDayAgo,
        now
      );

      if (dailyCount >= dailyLimit) {
        return {
          allowed: false,
          reason: 'USER_LIMIT',
          details: {
            limitType: 'pushDaily',
            limitValue: dailyLimit,
            currentCount: dailyCount,
            window: '24 hours',
          },
        };
      }
    }

    // Check per-tenant hourly limits
    const tenantHourlyLimit = config.defaults.perTenantHourly[channel];
    const tenantHourlyCount = await countTenantMessages(
      tenantId,
      channel,
      oneHourAgo,
      now
    );

    if (tenantHourlyCount >= tenantHourlyLimit) {
      return {
        allowed: false,
        reason: 'TENANT_LIMIT',
        details: {
          limitType: `tenant${channel}Hourly`,
          limitValue: tenantHourlyLimit,
          currentCount: tenantHourlyCount,
          window: '1 hour',
        },
      };
    }

    return { allowed: true };
  } catch (error: any) {
    logger.error(`Error checking rate limits:`, error);
    // On error, allow the message (fail open) but log the error
    return { allowed: true };
  }
}

