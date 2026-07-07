/**
 * Legacy Message Helpers
 * 
 * Helper functions that wrap the unified messaging orchestrator for legacy code paths.
 * These maintain backward compatibility while modernizing under the hood.
 * 
 * Phase 3: Route all legacy SMS through orchestrator
 */

import { logger } from 'firebase-functions/v2';
import { sendMessage } from './routingOrchestrator';
import { dispatchSystemMessage } from './systemMessageDispatcher';
import {
  containsWaitlistCopy,
  isApplicationStatusWaitlisted,
  logWaitlistNotificationsSuppressed,
  shouldSendApplicationWaitlistNotifications,
} from './applicationWaitlistNotificationsGate';
import {
  mapApplicationStatusToTriggerKey,
  mapAssignmentStatusToTriggerKey,
  SYSTEM_TRIGGER_KEYS,
} from './triggerRegistry';

/**
 * Send legacy application status message
 * Wraps orchestrator.sendMessage() for backward compatibility
 */
export async function sendLegacyApplicationStatusMessage(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  message: string;
  /** Email subject (e.g. "Gregory, Your Application Was Received"); used when sending email so subject is not derived from first line of body */
  emailSubject?: string;
  source: 'application_created' | 'application_status_changed';
  sourceId?: string;
  applicationId?: string;
  status?: string;
  /** Full application doc so template resolver can resolve jobTitle, locationCity, etc. */
  applicationData?: Record<string, any>;
  jobOrderId?: string;
  jobPostId?: string;
  /** When set, SMS/email use this registry id instead of inferring from status (e.g. combined application + interview first touch). */
  messageTypeIdOverride?: string;
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    // Gate: block any waitlisted-status send (regardless of source) when the
    // global waitlist notifications flag is off. Previously this was scoped to
    // `source === 'application_status_changed'`, which let `application_created`
    // callers slip through when the initial status was already 'waitlisted'.
    if (
      isApplicationStatusWaitlisted(args.status) &&
      !shouldSendApplicationWaitlistNotifications()
    ) {
      logWaitlistNotificationsSuppressed('sendLegacyApplicationStatusMessage', {
        tenantId: args.tenantId,
        userId: args.userId,
        applicationId: args.applicationId,
        source: args.source,
      });
      return {
        success: true,
        messageId: null,
        status: 'skipped_waitlist',
        error: 'waitlist_notifications_disabled',
      };
    }

    // Content-based safety net: if the caller-provided message body or email
    // subject reads like waitlist copy (e.g. tenant SMS template for
    // `application_received` was misconfigured with waitlist language),
    // refuse to deliver when the gate is off. Applies to every source.
    if (
      !shouldSendApplicationWaitlistNotifications() &&
      containsWaitlistCopy(args.message, args.emailSubject)
    ) {
      logWaitlistNotificationsSuppressed('sendLegacyApplicationStatusMessage.content_match', {
        tenantId: args.tenantId,
        userId: args.userId,
        applicationId: args.applicationId,
        source: args.source,
        status: args.status,
      });
      return {
        success: true,
        messageId: null,
        status: 'skipped_waitlist_content',
        error: 'waitlist_notifications_disabled_content_match',
      };
    }

    const triggerKey =
      args.source === 'application_created'
        ? SYSTEM_TRIGGER_KEYS.applicationReceived
        : mapApplicationStatusToTriggerKey(args.status || '');
    if (triggerKey && !args.messageTypeIdOverride) {
      const dispatched = await dispatchSystemMessage({
        tenantId: args.tenantId,
        triggerKey,
        userId: args.userId,
        context: {
          applicationId: args.applicationId,
          status: args.status,
          message: args.message,
          applicationData: args.applicationData,
          jobOrderId: args.jobOrderId,
          jobPostId: args.jobPostId,
        },
        metadata: {
          source: args.source,
          sourceId: args.sourceId,
        },
        source: 'system',
        sourceId: args.sourceId,
      });
      if (dispatched.handled) {
        return {
          success: dispatched.sent,
          messageId: null,
          status: dispatched.sent ? 'sent' : 'failed',
          error: dispatched.errors[0],
        };
      }
    }

    // Map source to message type
    let messageTypeId = args.messageTypeIdOverride || 'application_received';
    if (!args.messageTypeIdOverride && args.source === 'application_status_changed') {
      if (args.status === 'submitted') messageTypeId = 'application_received'; // re-apply: same as new application
      else if (args.status === 'screened') messageTypeId = 'application_screened';
      else if (args.status === 'advanced') messageTypeId = 'application_advanced';
      else if (args.status === 'offer') messageTypeId = 'application_offered';
      else if (args.status === 'hired') messageTypeId = 'application_hired';
      // 'accepted' / 'confirmed' must route to application_hired, never to the
      // generic application_status_change template (which many tenants have
      // configured with waitlist / generic-update copy).
      else if (args.status === 'accepted') messageTypeId = 'application_hired';
      else if (args.status === 'confirmed') messageTypeId = 'application_hired';
      else if (args.status === 'rejected') messageTypeId = 'application_rejected';
      else if (args.status === 'waitlisted') messageTypeId = 'application_waitlisted';
      else messageTypeId = 'application_status_change';
    }
    
    const applicationCtaUrl = args.jobPostId ? `/c1/jobs-board/${args.jobPostId}` : '/c1/workers/applications';
    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId,
      variables: {
        _message: args.message,
        _directMessage: true,
        ...(args.emailSubject != null && args.emailSubject !== '' ? { _subject: args.emailSubject } : {}),
      },
      metadata: {
        applicationId: args.applicationId,
        status: args.status,
        ctaUrl: applicationCtaUrl,
      },
      source: 'system',
      sourceId: args.sourceId,
    });
    
    // Convert orchestrator result to legacy format
    const smsResult = result.deliveryResults.find(r => r.channel === 'sms');
    if (smsResult) {
      return {
        success: smsResult.success,
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'unknown',
        error: smsResult.error,
      };
    }
    
    // SMS was not attempted (e.g. skipped by consent/preferences) – surface reason for logging
    const smsSkipped = result.routingDecision.skippedChannels?.find(s => s.channel === 'sms');
    const reason = smsSkipped?.reason ?? result.routingDecision.reason ?? 'SMS channel not selected';
    return {
      success: result.success,
      messageId: null,
      status: result.success ? 'sent' : 'failed',
      error: reason,
    };
  } catch (error: any) {
    logger.error(`Error sending legacy application message:`, error);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Send legacy group/bulk message
 * Wraps orchestrator.sendMessage() for backward compatibility
 */
export async function sendLegacyGroupMessage(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  message: string;
  source?: string;
  sourceId?: string;
  messageTypeId?: string;
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId: args.messageTypeId || 'bulk_message',
      variables: {
        _rawMessage: args.message,
      },
      metadata: {},
      source: args.source || 'system',
      sourceId: args.sourceId,
    });
    
    const smsResult = result.deliveryResults.find(r => r.channel === 'sms');
    if (smsResult) {
      return {
        success: smsResult.success,
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'unknown',
        error: smsResult.error,
      };
    }
    
    return {
      success: result.success,
      messageId: null,
      status: result.success ? 'sent' : 'failed',
      error: result.routingDecision.reason,
    };
  } catch (error: any) {
    logger.error(`Error sending legacy group message:`, error);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Send legacy shift reminder/notification
 * Wraps orchestrator.sendMessage() for backward compatibility
 */
export async function sendLegacyShiftMessage(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  message: string;
  messageTypeId?: string;
  source?: string;
  sourceId?: string;
  shiftId?: string;
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId: args.messageTypeId || 'shift_reminder',
      variables: {
        _rawMessage: args.message,
      },
      metadata: {
        shiftId: args.shiftId,
      },
      source: args.source || 'system',
      sourceId: args.sourceId,
    });
    
    const smsResult = result.deliveryResults.find(r => r.channel === 'sms');
    if (smsResult) {
      return {
        success: smsResult.success,
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'unknown',
        error: smsResult.error,
      };
    }
    
    return {
      success: result.success,
      messageId: null,
      status: result.success ? 'sent' : 'failed',
      error: result.routingDecision.reason,
    };
  } catch (error: any) {
    logger.error(`Error sending legacy shift message:`, error);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Send legacy broadcast message
 * Wraps orchestrator.sendMessage() for backward compatibility
 */
export async function sendLegacyBroadcastMessage(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  message: string;
  broadcastId: string;
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId: 'broadcast',
      variables: {
        _rawMessage: args.message,
      },
      metadata: {
        broadcastId: args.broadcastId,
      },
      source: 'system',
      sourceId: args.broadcastId,
    });
    
    const smsResult = result.deliveryResults.find(r => r.channel === 'sms');
    if (smsResult) {
      return {
        success: smsResult.success,
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'unknown',
        error: smsResult.error,
      };
    }
    
    return {
      success: result.success,
      messageId: null,
      status: result.success ? 'sent' : 'failed',
      error: result.routingDecision.reason,
    };
  } catch (error: any) {
    logger.error(`Error sending legacy broadcast message:`, error);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Send legacy assignment message
 * Wraps orchestrator.sendMessage() for backward compatibility
 */
export async function sendLegacyAssignmentMessage(args: {
  tenantId: string;
  userId: string;
  phoneE164: string;
  message: string;
  messageTypeId?: string;
  source?: string;
  sourceId?: string;
  assignmentId?: string;
  /** When set, email is sent with this subject and HTML body (assignment details); SMS uses args.message */
  emailSubject?: string;
  emailBody?: string;
  /** Pass assignment/job order data so template variables (jobTitle, locationCity) resolve from worksite, not user address */
  assignmentData?: Record<string, unknown>;
  jobOrderId?: string;
  jobOrderData?: Record<string, unknown>;
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const statusForTrigger =
      args.messageTypeId === 'assignment_confirmed'
        ? 'confirmed'
        : args.messageTypeId === 'assignment_active'
        ? 'in_progress'
        : args.messageTypeId === 'assignment_completed'
        ? 'completed'
        : args.messageTypeId === 'assignment_cancelled'
        ? 'cancelled'
        : '';
    const triggerKey =
      args.source === 'assignment_created'
        ? SYSTEM_TRIGGER_KEYS.assignmentCreated
        : mapAssignmentStatusToTriggerKey(statusForTrigger);
    // When we already built the full assignment-details HTML (staff instructions + links), do not
    // short-circuit through tenant automation rules — those templates omit cascaded instructions and
    // would block the rich email entirely when rules exist but fail to send.
    if (triggerKey && !(args.emailSubject && args.emailBody)) {
      const dispatched = await dispatchSystemMessage({
        tenantId: args.tenantId,
        triggerKey,
        userId: args.userId,
        context: {
          assignmentId: args.assignmentId,
          message: args.message,
          status: args.messageTypeId,
          assignmentData: args.assignmentData,
          jobOrderId: args.jobOrderId,
          jobOrderData: args.jobOrderData,
        },
        metadata: {
          source: args.source,
          sourceId: args.sourceId,
        },
        source: 'system',
        sourceId: args.sourceId,
      });
      if (dispatched.handled) {
        return {
          success: dispatched.sent,
          messageId: null,
          status: dispatched.sent ? 'sent' : 'failed',
          error: dispatched.errors[0],
        };
      }
    }

    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId: args.messageTypeId || 'assignment_created',
      variables: {
        _rawMessage: args.message,
        _directMessage: true,
        _message: (args.emailBody && args.emailSubject) ? args.emailBody : args.message,
        ...(args.emailSubject ? { _subject: args.emailSubject } : {}),
      },
      metadata: {
        assignmentId: args.assignmentId,
        ctaUrl: args.assignmentId
          ? `/c1/workers/assignments/${args.assignmentId}`
          : '/c1/workers/assignments',
      },
      source: args.source || 'system',
      sourceId: args.sourceId,
    });
    
    const smsResult = result.deliveryResults.find(r => r.channel === 'sms');
    if (smsResult) {
      return {
        success: smsResult.success,
        messageId: smsResult.messageId || null,
        status: smsResult.status || 'unknown',
        error: smsResult.error,
      };
    }
    
    return {
      success: result.success,
      messageId: null,
      status: result.success ? 'sent' : 'failed',
      error: result.routingDecision.reason,
    };
  } catch (error: any) {
    logger.error(`Error sending legacy assignment message:`, error);
    return {
      success: false,
      messageId: null,
      status: 'failed',
      error: error.message || 'Unknown error',
    };
  }
}

