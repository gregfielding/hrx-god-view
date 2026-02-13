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
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const triggerKey =
      args.source === 'application_created'
        ? SYSTEM_TRIGGER_KEYS.applicationReceived
        : mapApplicationStatusToTriggerKey(args.status || '');
    if (triggerKey) {
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
    let messageTypeId = 'application_received';
    if (args.source === 'application_status_changed') {
      if (args.status === 'submitted') messageTypeId = 'application_received'; // re-apply: same as new application
      else if (args.status === 'screened') messageTypeId = 'application_screened';
      else if (args.status === 'advanced') messageTypeId = 'application_advanced';
      else if (args.status === 'hired') messageTypeId = 'application_hired';
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
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const result = await sendMessage({
      tenantId: args.tenantId,
      userId: args.userId,
      messageTypeId: 'bulk_message',
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
}): Promise<{ success: boolean; messageId: string | null; status: string; error?: string }> {
  try {
    const statusForTrigger =
      args.messageTypeId === 'assignment_confirmed'
        ? 'confirmed'
        : args.messageTypeId === 'assignment_active'
        ? 'active'
        : args.messageTypeId === 'assignment_completed'
        ? 'completed'
        : args.messageTypeId === 'assignment_cancelled'
        ? 'cancelled'
        : '';
    const triggerKey =
      args.source === 'assignment_created'
        ? SYSTEM_TRIGGER_KEYS.assignmentCreated
        : mapAssignmentStatusToTriggerKey(statusForTrigger);
    if (triggerKey) {
      const dispatched = await dispatchSystemMessage({
        tenantId: args.tenantId,
        triggerKey,
        userId: args.userId,
        context: {
          assignmentId: args.assignmentId,
          message: args.message,
          status: args.messageTypeId,
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
        _message: args.message,
      },
      metadata: {
        assignmentId: args.assignmentId,
        ctaUrl: '/c1/workers/assignments', // deepLink for push so tap opens Assignments
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

