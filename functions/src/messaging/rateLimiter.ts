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
  /**
   * `MessageContext.source`. When `'recruiter'`, the send is initiated by a
   * human operator (MessageDrawer bulk send, recruiter inbox reply,
   * `senderVerification` flow, etc.) and the per-user cap is skipped — the
   * tenant-hourly cap still applies. The per-user cap is intended to stop
   * automated triggers from looping on a single user, not to throttle a
   * recruiter sending one message to each of N recipients in a smart group.
   */
  source?: string;
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
 * Message types that are transactional (application/assignment status) and should
 * not be blocked by per-user rate limits so status updates always reach the user.
 */
const RATE_LIMIT_EXEMPT_MESSAGE_TYPES = new Set([
  'application_received',
  'application_received_interview_next_step',
  'application_status_change',
  'application_offered',
  'application_waitlisted',
  'application_rejected',
  'application_screened',
  'application_advanced',
  'application_hired',
  'application_requirements_reminder',
  'assignment_created',
  'assignment_status_change',
  'assignment_confirmed',
  'shift_details_updated',
  'assignment_cancelled',
  'assignment_active',
  'assignment_completed',
  'assignment_reminder_24h',
  'assignment_reminder_2h',
  'recent_user_backfill_interview_invite',
  'worker_onboarding_pipeline_started',
  'on_call_employment_started',
  'payroll_onboarding_invite_needed',
  'onboarding_reminder',
  // Payroll "action needed" category (2026-08-28): money is stuck and only
  // the worker can fix it — must not be starved by general caps.
  'payroll_payment_returned',
  'payroll_setup_blocking_pay',
  // Post-shift earnings confirmation (2026-08-29) — wanted receipt, 1/day.
  'payroll_hours_confirmed',
]);

/**
 * Hard per-user daily SMS ceilings for exemption-branch types (2026-08
 * audit). Default applies to every type in RATE_LIMIT_EXEMPT_MESSAGE_TYPES;
 * overrides tighten specific offenders. bulk_direct_sms is capped here so
 * recruiter re-blasts can't stack unlimited same-day texts on one worker
 * (1:1 direct_message replies are deliberately NOT capped).
 */
const EXEMPT_TYPE_DAILY_CAP_DEFAULT = 3;
const TYPE_DAILY_CAP_OVERRIDES: Record<string, number> = {
  onboarding_reminder: 1,
  bulk_direct_sms: 3,
  payroll_payment_returned: 1,
  payroll_setup_blocking_pay: 1,
  payroll_hours_confirmed: 1,
};

/**
 * Claim one of the per-user-per-type daily SMS slots. Counter docs (not
 * messageLogs queries) so no composite index is needed; the claim is a
 * reservation made at check time — a later send failure slightly
 * undercounts capacity, which errs on the quiet side. Fail-open on
 * transaction errors: rate limiting must never block a send outright.
 */
export async function claimTypeDailySlot(
  tenantId: string,
  userId: string,
  messageTypeId: string,
  cap: number
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('messagingConfig')
    .doc('typeDailyCaps')
    .collection('counters')
    .doc(`${userId}__${messageTypeId}__${day}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const n = Number(snap.data()?.count ?? 0);
      if (n >= cap) return false;
      tx.set(
        ref,
        {
          count: n + 1,
          userId,
          messageTypeId,
          day,
          updatedAt: admin.firestore.Timestamp.now(),
        },
        { merge: true }
      );
      return true;
    });
  } catch (err) {
    logger.warn('claimTypeDailySlot failed open', {
      tenantId,
      userId,
      messageTypeId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

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
  const { tenantId, userId, messageTypeId, channel, source } = args;

  try {
    // Recruiter-initiated sends bypass the per-user cap. The cap is intended
    // to stop automated triggers from spamming a single user; a recruiter
    // explicitly choosing recipients (MessageDrawer bulk to a smart group,
    // inbox reply, senderVerification handshake) is a different shape — each
    // recipient typically gets exactly one message from the batch. Tenant-
    // hourly cap below still applies as the runaway-protection backstop.
    // Same fall-through structure as RATE_LIMIT_EXEMPT_MESSAGE_TYPES so the
    // tenant cap stays consistent across exempt branches.
    if (RATE_LIMIT_EXEMPT_MESSAGE_TYPES.has(messageTypeId) || source === 'recruiter') {
      // 2026-08 audit: "exempt" must mean a HIGHER bound, never NO bound —
      // a status flip-flop once sent ~180 confirmations to one worker in a
      // day, and bulk re-blasts stacked +894 same-day repeats, all through
      // this branch. Hard per-user-per-type daily ceiling for SMS.
      if (channel === 'sms') {
        const typeCap =
          TYPE_DAILY_CAP_OVERRIDES[messageTypeId] ??
          (RATE_LIMIT_EXEMPT_MESSAGE_TYPES.has(messageTypeId) ? EXEMPT_TYPE_DAILY_CAP_DEFAULT : null);
        if (typeCap != null) {
          const slotOk = await claimTypeDailySlot(tenantId, userId, messageTypeId, typeCap);
          if (!slotOk) {
            return {
              allowed: false,
              reason: 'USER_LIMIT',
              details: {
                limitType: `smsDailyPerType:${messageTypeId}`,
                limitValue: typeCap,
                currentCount: typeCap,
                window: '1 day',
              },
            };
          }
        }
      }
      // Still enforce tenant-level limits to prevent abuse
      const config = await getRateLimitConfig(tenantId);
      const now = admin.firestore.Timestamp.now();
      const oneHourAgo = admin.firestore.Timestamp.fromMillis(
        now.toMillis() - 60 * 60 * 1000
      );
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
            limitType: `${channel}Hourly`,
            limitValue: tenantHourlyLimit,
            currentCount: tenantHourlyCount,
            window: '1 hour',
          },
        };
      }
      return { allowed: true };
    }

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

