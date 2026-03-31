/**
 * Routing & Delivery Orchestrator
 * 
 * Central orchestrator for message routing and delivery decisions.
 * Implements the unified messaging framework routing logic.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 5
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { getMessageTypeConfig, Channel, MessageTypeConfig } from './messageTypesRegistry';
import { getUserNotificationSettings, NotificationSettings } from '../utils/notificationSettings';
import { logMessage, MessageLog, MessageDirection, MessageFromIdentity, MessageStatus, MessageLanguage } from './messageLogging';
import type { TemplateVariableContext } from '../utils/templateVariableResolver';
import { getTemplate, renderTemplate, renderTemplateHtmlBody, renderStringWithVariables, MessageTemplate } from './templateEngine';
import { getEmailProvider, isSendGridConfigured } from './emailProviderFactory';
import { getSmsProvider } from './smsProviderFactory';
import { getPushProvider } from './pushProviderFactory';
import { writeWorkerInboxNotification } from './unifiedWorkerNotifications';
import { getTenantSmsConsent } from './tenantConsent';
import { getTenantNotificationSettings, isChannelAllowedForUser } from './tenantNotificationSettings';
import { checkRateLimits } from './rateLimiter';
import { isQuietHours } from './quietHours';
import { resolveSenderIdentity, SenderIdentity } from './senderIdentity';
import { findOrCreateEmailThread, addMessageToThread } from './emailThreading';

const db = admin.firestore();

export interface MessageContext {
  userId: string;
  tenantId: string;
  messageTypeId: string;
  variables?: Record<string, any>; // Template variables
  metadata?: Record<string, any>;   // Additional metadata
  source?: string;                  // Source of the message (e.g., 'application_status_changed')
  sourceId?: string;                // ID of the source entity
  priority?: 'low' | 'normal' | 'high';
  overrideChannels?: Channel[];      // Override default channels (e.g., from MessageDrawer)
}

export interface RoutingDecision {
  channels: Channel[];
  shouldSend: boolean;
  reason?: string;
  skippedChannels: {
    channel: Channel;
    reason: string;
  }[];
}

export interface DeliveryResult {
  channel: Channel;
  success: boolean;
  messageId?: string;
  error?: string;
  status?: string;
  suppressed?: boolean; // PHASE 5: Indicates message was suppressed (rate limit, quiet hours, etc.)
}

export interface SendMessageResult {
  success: boolean;
  messageTypeId: string;
  userId: string;
  routingDecision: RoutingDecision;
  deliveryResults: DeliveryResult[];
  messageLogId?: string;
}

/**
 * Main entry point: Send a message through the unified messaging system
 */
export async function sendMessage(context: MessageContext): Promise<SendMessageResult> {
  const startTime = Date.now();
  
  try {
    logger.info(`Routing message: ${context.messageTypeId} to user ${context.userId}`);
    
    // 1. Get message type configuration
    const messageTypeConfig = await getMessageTypeConfig(context.tenantId, context.messageTypeId);
    if (!messageTypeConfig) {
      logger.error(`Message type ${context.messageTypeId} not found for tenant ${context.tenantId}`);
      // Check if it exists in DEFAULT_MESSAGE_TYPES for debugging
      const { DEFAULT_MESSAGE_TYPES } = await import('./messageTypesRegistry');
      const existsInDefaults = DEFAULT_MESSAGE_TYPES.find(t => t.id === context.messageTypeId);
      if (existsInDefaults) {
        logger.warn(`Message type ${context.messageTypeId} exists in DEFAULT_MESSAGE_TYPES but getMessageTypeConfig returned null`);
      }
      throw new Error(`Message type ${context.messageTypeId} not found`);
    }
    
    if (!messageTypeConfig.enabled) {
      logger.info(`Message type ${context.messageTypeId} is disabled, skipping`);
      return {
        success: false,
        messageTypeId: context.messageTypeId,
        userId: context.userId,
        routingDecision: {
          channels: [],
          shouldSend: false,
          reason: 'Message type is disabled',
          skippedChannels: [],
        },
        deliveryResults: [],
      };
    }
    
    // 2. Get user data and preferences
    const userDoc = await db.doc(`users/${context.userId}`).get();
    if (!userDoc.exists) {
      throw new Error(`User ${context.userId} not found`);
    }
    const userData = userDoc.data()!;
    
    const notificationSettings = await getUserNotificationSettings(context.userId);
    
    // PHASE 4: Also get tenant-scoped notification settings
    const tenantNotificationSettings = await getTenantNotificationSettings(
      context.tenantId,
      context.userId
    );
    
    // 3. Make routing decision
    const routingDecision = await makeRoutingDecision(
      messageTypeConfig,
      notificationSettings,
      tenantNotificationSettings,
      userData,
      context
    );
    
    if (!routingDecision.shouldSend || routingDecision.channels.length === 0) {
      logger.info(`No channels available for message ${context.messageTypeId} to user ${context.userId}: ${routingDecision.reason}`);
      
      // Log the attempt even if no channels
      await logMessageAttempt(context, routingDecision, [], userData);
      
      return {
        success: false,
        messageTypeId: context.messageTypeId,
        userId: context.userId,
        routingDecision,
        deliveryResults: [],
      };
    }
    
    // 4. Deliver via each channel
    const deliveryResults: DeliveryResult[] = [];
    
    for (const channel of routingDecision.channels) {
      try {
        const result = await deliverMessage(channel, context, messageTypeConfig, userData);
        deliveryResults.push(result);
      } catch (error: any) {
        logger.error(`Error delivering message via ${channel}:`, error);
        deliveryResults.push({
          channel,
          success: false,
          error: error.message || 'Unknown error',
        });
      }
    }
    
    // 5. Log the message attempt
    const messageLogId = await logMessageAttempt(context, routingDecision, deliveryResults, userData);
    
    // 6. Determine overall success
    const overallSuccess = deliveryResults.some(r => r.success) || 
                           (messageTypeConfig.critical && deliveryResults.length > 0);
    
    logger.info(`Message ${context.messageTypeId} delivered to user ${context.userId} via ${routingDecision.channels.length} channels in ${Date.now() - startTime}ms`);
    
    return {
      success: overallSuccess,
      messageTypeId: context.messageTypeId,
      userId: context.userId,
      routingDecision,
      deliveryResults,
      messageLogId,
    };
  } catch (error: any) {
    logger.error(`Error in sendMessage for ${context.messageTypeId}:`, error);
    throw error;
  }
}

/**
 * Make routing decision based on message type, user preferences, and compliance rules
 */
async function makeRoutingDecision(
  messageTypeConfig: MessageTypeConfig,
  notificationSettings: NotificationSettings,
  tenantNotificationSettings: any, // TenantNotificationSettings | null
  userData: admin.firestore.DocumentData,
  context: MessageContext
): Promise<RoutingDecision> {
  const channels: Channel[] = [];
  const skippedChannels: { channel: Channel; reason: string }[] = [];
  
  // Use overrideChannels if provided (e.g., from MessageDrawer), otherwise use defaultChannels
  const channelsToCheck = context.overrideChannels || messageTypeConfig.defaultChannels;
  
  // Check each channel against user preferences and compliance rules
  for (const channel of channelsToCheck) {
    const shouldUse = await shouldUseChannel(
      channel,
      messageTypeConfig,
      notificationSettings,
      tenantNotificationSettings,
      userData,
      context
    );
    
    if (shouldUse.allowed) {
      channels.push(channel);
    } else {
      skippedChannels.push({
        channel,
        reason: shouldUse.reason || 'Channel not allowed',
      });
    }
  }
  
  // Determine if we should send at all
  let shouldSend = channels.length > 0;
  let reason: string | undefined;
  
  if (!shouldSend) {
    if (messageTypeConfig.critical) {
      // For critical messages, try to send via any available channel
      // This is a fallback - in practice, critical messages should have multiple channels configured
      reason = 'No channels available for critical message';
    } else {
      reason = 'All channels disabled or blocked by user preferences';
    }
  }
  
  return {
    channels,
    shouldSend,
    reason,
    skippedChannels,
  };
}

/**
 * Check if a channel should be used for this message
 */
/**
 * Check if a channel should be used for this message
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 3.3 Update Orchestrator Consent Checks
 */
async function shouldUseChannel(
  channel: Channel,
  messageTypeConfig: MessageTypeConfig,
  notificationSettings: NotificationSettings,
  tenantNotificationSettings: any, // TenantNotificationSettings | null
  userData: admin.firestore.DocumentData,
  context: MessageContext
): Promise<{ allowed: boolean; reason?: string }> {
  // Test sends: skip tenant notification setting blocks (user explicitly chose recipient for test)
  const isTestSend = context.metadata?.testSend === true;
  if (!isTestSend) {
    // PHASE 4: Check tenant-scoped notification settings first
    if (tenantNotificationSettings) {
      const channelAllowed = isChannelAllowedForUser(
        channel,
        context.messageTypeId,
        tenantNotificationSettings
      );
      
      if (!channelAllowed) {
        return { allowed: false, reason: `Channel ${channel} disabled in tenant notification settings` };
      }
    }
  }
  
  // SMS channel checks
  if (channel === 'sms') {
    // PHASE 4: Prefer user doc (Privacy & Notifications UI) then tenant consent (STOP/START keyword)
    const tenantConsent = await getTenantSmsConsent(context.tenantId, context.userId);
    const smsBlockedSystem = userData.smsBlockedSystem ?? tenantConsent?.smsBlockedSystem ?? false;
    const smsOptIn = (userData.smsOptIn ?? tenantConsent?.smsOptIn) !== false;
    
    // Always block if user has blocked SMS (STOP keyword)
    if (smsBlockedSystem) {
      return { allowed: false, reason: 'User has blocked SMS (STOP keyword)' };
    }

    // Test sends (e.g. Send Test Message in Messaging UI): relax consent/verification for intentional test
    if (isTestSend) {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }

    /**
     * Tenant message automation (`dispatchSystemMessage`) often uses template `messageTypeId` = direct_message with
     * `metadata.triggerKey`. Do not require `phoneVerified` — only STOP/opt-out, smsOptIn, master SMS toggle, tenant
     * channel policy, and a dialable number (same bar as payroll / assignment transactional SMS).
     */
    if (
      context.messageTypeId === 'direct_message' &&
      typeof context.metadata?.triggerKey === 'string' &&
      context.metadata.triggerKey.length > 0 &&
      context.source !== 'recruiter'
    ) {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone?.trim()) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      if (!smsOptIn) {
        return { allowed: false, reason: 'SMS consent not given' };
      }
      if (!notificationSettings.sms.enabled) {
        return { allowed: false, reason: 'SMS disabled in notification settings' };
      }
      return { allowed: true };
    }

    // Assignment-created: recruiter explicitly offered position - allow SMS if user has phone (relax verification)
    if (context.messageTypeId === 'assignment_created') {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }

    if (context.messageTypeId === 'payroll_onboarding_invite_needed') {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }

    if (context.messageTypeId === 'worker_onboarding_pipeline_started') {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }

    if (context.messageTypeId === 'on_call_employment_started') {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }

    // Application status messages: attempt SMS if user has phone (relax verification to reach applicants)
    const isApplicationMessage =
      context.messageTypeId?.startsWith('application_') ||
      ['application_received', 'application_screened', 'application_advanced', 'application_hired', 'application_rejected', 'application_waitlisted', 'application_status_change', 'application_requirements_reminder'].includes(context.messageTypeId || '');
    if (isApplicationMessage) {
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
      return { allowed: true };
    }
    
    // Check if SMS opt-in is required for non-test sends
    if (messageTypeConfig.requiresExplicitSmsOptIn) {
      // Check SMS consent (tenant-scoped or legacy)
      if (!smsOptIn) {
        return { allowed: false, reason: 'SMS consent not given' };
      }
      
      // Check notification settings (legacy)
      if (!notificationSettings.sms.enabled) {
        return { allowed: false, reason: 'SMS disabled in notification settings' };
      }
      
      // Check type-specific setting (legacy)
      const typeSetting = notificationSettings.sms[context.messageTypeId as keyof typeof notificationSettings.sms];
      if (typeSetting === false) {
        return { allowed: false, reason: `SMS disabled for message type ${context.messageTypeId}` };
      }
      
      // Require a phone number. `phoneVerified` is never required here (OTP verification is optional for delivery).
      const phone = userData.phoneE164 || userData.phone;
      if (!phone) {
        return { allowed: false, reason: 'Recipient has no phone number' };
      }
    }
    
    return { allowed: true };
  }
  
  // Email channel checks
  if (channel === 'email') {
    // Email is generally always attempted (unless explicitly disabled)
    // PHASE 4: Check tenant notification settings
    if (tenantNotificationSettings && !tenantNotificationSettings.emailEnabled) {
      return { allowed: false, reason: 'Email disabled in tenant notification settings' };
    }
    
    if (!userData.email) {
      return { allowed: false, reason: 'User has no email address' };
    }
    
    return { allowed: true };
  }
  
  // Push channel checks
  if (channel === 'push') {
    // PHASE 4: Check tenant notification settings
    if (tenantNotificationSettings && !tenantNotificationSettings.pushEnabled) {
      return { allowed: false, reason: 'Push disabled in tenant notification settings' };
    }
    
    // Legacy check
    if (!notificationSettings.push.enabled) {
      return { allowed: false, reason: 'Push notifications disabled in notification settings' };
    }
    
    // Check if user has push tokens
    const pushTokens = userData.pushTokens;
    if (!pushTokens || !Array.isArray(pushTokens) || pushTokens.length === 0) {
      return { allowed: false, reason: 'No push tokens registered' };
    }
    
    return { allowed: true };
  }
  
  return { allowed: false, reason: 'Unknown channel' };
}

/**
 * Deliver message via a specific channel
 */
async function deliverMessage(
  channel: Channel,
  context: MessageContext,
  messageTypeConfig: MessageTypeConfig,
  userData: admin.firestore.DocumentData
): Promise<DeliveryResult> {
  try {
    if (channel === 'sms') {
      return await deliverSMS(context, messageTypeConfig, userData);
    } else if (channel === 'email') {
      return await deliverEmail(context, messageTypeConfig, userData);
    } else if (channel === 'push') {
      return await deliverPush(context, messageTypeConfig, userData);
    } else {
      return {
        channel,
        success: false,
        error: 'Unknown channel',
      };
    }
  } catch (error: any) {
    logger.error(`Error delivering ${channel} message:`, error);
    return {
      channel,
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/** Normalize phone to E.164 for Twilio. Handles (xxx)xxx-xxxx, +1..., 10/11 digits. */
function toE164(phone: string | undefined): string | null {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && phone.trim().startsWith('+')) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

/** Best-effort destination for audit / admin UI (message history modal). */
function outboundRecipientForChannel(
  channel: Channel,
  userData: admin.firestore.DocumentData
): { recipientPhoneE164?: string; recipientEmail?: string } {
  if (channel === 'sms') {
    const rawPhone = (userData.phoneE164 || userData.phone || '').trim();
    if (!rawPhone) return {};
    const e164 = rawPhone.startsWith('+') ? rawPhone : toE164(rawPhone);
    return { recipientPhoneE164: (e164 || rawPhone) as string };
  }
  if (channel === 'email') {
    const em = (userData.email || '').trim();
    return em ? { recipientEmail: em } : {};
  }
  return {};
}

/**
 * Deliver SMS message
 * 
 * Implements: HRX One Mock SMS Provider Plan — Section 6 Wire the Messaging Orchestrator to SmsProvider
 */
async function deliverSMS(
  context: MessageContext,
  messageTypeConfig: MessageTypeConfig,
  userData: admin.firestore.DocumentData
): Promise<DeliveryResult> {
  // Import here to avoid circular dependencies
  const { resolveTemplateVariables } = await import('../utils/templateVariableResolver');
  
  try {
    // Get user's preferred language
    const preferredLanguage = (userData.preferredLanguage || 'en') as 'en' | 'es';
    
    // Check if this is a direct message (no template required)
    const isDirectMessage = context.variables?._directMessage === true || !messageTypeConfig.requiresTemplate;
    const unifiedMessage = context.variables?._message as string | undefined;
    
    // Helper function to strip HTML and get plain text
    const stripHtml = (html: string): string => {
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    };
    
    // Get template (if required and not direct message)
    let messageContent = '';
    let templateUsed: MessageTemplate | null = null;
    
    // Handle direct message content (unified message - strip HTML for SMS)
    if (isDirectMessage && unifiedMessage) {
      // When _rawMessage is set (e.g. assignment_created), use it for SMS so SMS gets short text and email gets full HTML
      const rawMessage = context.variables?._rawMessage as string | undefined;
      if (rawMessage && typeof rawMessage === 'string' && rawMessage.trim()) {
        messageContent = rawMessage.trim();
      } else {
        messageContent = stripHtml(unifiedMessage);
      }
      // Truncate to 1600 characters for SMS
      if (messageContent.length > 1600) {
        messageContent = messageContent.substring(0, 1597) + '...';
      }
    } else if (messageTypeConfig.requiresTemplate) {
      // Use new template engine
      templateUsed = await getTemplate(
        context.tenantId,
        context.messageTypeId,
        'sms',
        preferredLanguage
      );
      
      if (templateUsed) {
        // Build template context
        const templateContext = {
          userId: context.userId,
          userData,
          tenantId: context.tenantId,
          ...context.variables,
        } as TemplateVariableContext;
        
        // Resolve variables using existing resolver
        const variables = await resolveTemplateVariables(templateContext);
        
        // Render template
        messageContent = await renderTemplate(templateUsed, variables, context.tenantId);
      } else {
        // No template found - log error
        logger.error(`No template found for ${context.messageTypeId}/sms/${preferredLanguage} in tenant ${context.tenantId}`);
        
        // For critical messages, use failsafe
        if (messageTypeConfig.critical) {
          messageContent = `You have a new ${messageTypeConfig.label.toLowerCase()}. Please check your account. Reply STOP to unsubscribe, HELP for help.`;
        } else {
          // Non-critical: don't send
          return {
            channel: 'sms',
            success: false,
            error: 'Template not found and message is not critical',
          };
        }
      }
    } else {
      // Use provided message or default
      messageContent = context.variables?.message || `You have a new message from ${messageTypeConfig.label}.`;
      
      // Add STOP footer if replies allowed
      if (messageTypeConfig.allowReply) {
        messageContent += ' Reply STOP to unsubscribe, HELP for help.';
      }
    }
    
    // PHASE 5.1: Check rate limits before sending (skip for test sends)
    const isTestSend = context.metadata?.testSend === true;
    const rateLimitCheck = isTestSend
      ? { allowed: true }
      : await checkRateLimits({
          tenantId: context.tenantId,
          userId: context.userId,
          messageTypeId: context.messageTypeId,
          channel: 'sms',
        });

    if (!rateLimitCheck.allowed && 'reason' in rateLimitCheck && 'details' in rateLimitCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'sms',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: messageContent,
        contentSent: messageContent,
        language: preferredLanguage,
        status: 'suppressed_rate_limit',
        failureReason: JSON.stringify(rateLimitCheck.details),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...outboundRecipientForChannel('sms', userData),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`SMS suppressed due to rate limit for user ${context.userId}: ${rateLimitCheck.reason}`);
      
      return {
        channel: 'sms',
        success: false,
        suppressed: true,
        error: `Rate limit exceeded: ${rateLimitCheck.reason}`,
      };
    }

    // PHASE 5.2: Check quiet hours before sending (skip for test sends)
    const quietHoursCheck = isTestSend
      ? false
      : await isQuietHours({
          tenantId: context.tenantId,
          messageTypeId: context.messageTypeId,
        });

    if (quietHoursCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'sms',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: messageContent,
        contentSent: messageContent,
        language: preferredLanguage,
        status: 'suppressed_quiet_hours',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...outboundRecipientForChannel('sms', userData),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`SMS suppressed due to quiet hours for user ${context.userId}`);
      
      return {
        channel: 'sms',
        success: false,
        suppressed: true,
        error: 'Message suppressed due to quiet hours',
      };
    }

    // Resolve recipient: allow phoneE164 or phone (application flow may only have phone)
    const rawPhone = (userData.phoneE164 || userData.phone || '').trim();
    const toPhoneE164 = rawPhone.startsWith('+') ? rawPhone : toE164(rawPhone);

    // Create initial log entry (status: queued)
    const logRef = db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('messageLogs')
      .doc();
    
    const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
      createdAt: admin.firestore.FieldValue;
    } = {
      tenantId: context.tenantId,
      userId: context.userId,
      threadId: context.metadata?.threadId || undefined,
      messageTypeId: context.messageTypeId,
      channel: 'sms',
      direction: 'outbound',
      fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
      fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
      contentOriginal: messageContent,
      contentSent: messageContent,
      language: preferredLanguage,
      status: 'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...outboundRecipientForChannel('sms', userData),
    };
    
    await logRef.set(logDoc);
    if (!toPhoneE164) {
      return {
        channel: 'sms',
        success: false,
        error: 'Required parameter "params[\'to\']" missing (no phone number on user)',
      };
    }

    // Resolve sender identity to get recruiter number if available
    const senderIdentity = await resolveSenderIdentity(context.tenantId, context);
    
    // Send via SmsProvider (mock or Twilio based on SMS_PROVIDER env var)
    const smsProvider = getSmsProvider();
    
    // Get from number: use recruiter number if available, otherwise use main number
    const fromNumber = senderIdentity.twilioNumber || process.env.TWILIO_MESSAGING_PHONE_NUMBER || '';
    
    const result = await smsProvider.sendSms({
      tenantId: context.tenantId,
      to: toPhoneE164,
      from: fromNumber,
      body: messageContent,
      messageTypeId: context.messageTypeId,
      userId: context.userId,
      threadId: context.metadata?.threadId,
    });
    
    // Update log with final status
    const update: any = {
      status: result.success ? 'sent' : 'failed',
    };
    
    if (result.providerMessageId) {
      update.providerMessageId = result.providerMessageId;
    }
    if (!result.success) {
      update.failureReason = result.errorMessage || result.errorCode || 'Unknown error';
    }
    
    await logRef.update(update);
    
    logger.info(`SMS ${result.success ? 'sent' : 'failed'} for ${context.messageTypeId} to user ${context.userId}: ${result.providerMessageId || result.errorMessage}`);
    
    return {
      channel: 'sms',
      success: result.success,
      messageId: result.providerMessageId,
      error: result.errorMessage,
      status: result.success ? 'sent' : 'failed',
    };
  } catch (error: any) {
    logger.error('Error delivering SMS:', error);
    return {
      channel: 'sms',
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Deliver email message
 * 
 * Implements: HRX One Email Provider Spec — Section 4 Integrating with Messaging Orchestrator
 */
async function deliverEmail(
  context: MessageContext,
  messageTypeConfig: MessageTypeConfig,
  userData: admin.firestore.DocumentData
): Promise<DeliveryResult> {
  try {
    // Resolve sender identity
    let senderIdentity = await resolveSenderIdentity(context.tenantId, context);

    // CRITICAL POLICY:
    // User-composed emails (recruiter sending, or explicit direct_message type) must NEVER fall back to SendGrid.
    // System messages (e.g. application_received) use _directMessage for pre-rendered body but should use SendGrid.
    const isUserComposedEmail =
      context.source === 'recruiter' ||
      context.messageTypeId === 'direct_message';
    if (isUserComposedEmail) {
      if (senderIdentity.emailProvider !== 'gmail' || !senderIdentity.gmailUserId) {
        return {
          channel: 'email',
          success: false,
          error:
            'Gmail connection required to send email. Please connect Gmail in Settings (no SendGrid fallback for user emails).',
        };
      }
    }
    
    // Get appropriate email provider based on sender identity
    let emailProvider;
    try {
      emailProvider = getEmailProvider(senderIdentity);
      if (senderIdentity?.emailProvider === 'sendgrid') {
        logger.info('SendGrid available', {
          configured: isSendGridConfigured(),
          messageTypeId: context.messageTypeId,
          userId: context.userId,
        });
      }
    } catch (configError: any) {
      logger.warn(`Email provider not configured: ${configError.message}`);
      return {
        channel: 'email',
        success: false,
        error: 'Email provider not configured',
      };
    }
    
    // Import template functions
    const { resolveTemplateVariables } = await import('../utils/templateVariableResolver');
    
    // Get user's preferred language
    const preferredLanguage = (userData.preferredLanguage || 'en') as 'en' | 'es';
    
    // 1. Check if this is a direct message (no template required)
    const isDirectMessage = context.variables?._directMessage === true || !messageTypeConfig.requiresTemplate;
    const unifiedMessage = context.variables?._message as string | undefined;
    
    // Helper function to extract text from HTML
    const stripHtml = (html: string): string => {
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    };
    
    // Helper function to extract subject/title from message (first line or first sentence)
    const extractSubject = (html: string, maxLength: number = 100): string => {
      const text = stripHtml(html);
      // Try to get first sentence (ends with . ! or ?)
      const firstSentenceMatch = text.match(/^[^.!?]+[.!?]/);
      if (firstSentenceMatch) {
        return firstSentenceMatch[0].trim().substring(0, maxLength);
      }
      // Otherwise get first line
      const firstLine = text.split('\n')[0].trim();
      return firstLine.substring(0, maxLength);
    };
    
    // 2. Resolve email template (if not direct message)
    let template = null;
    if (!isDirectMessage || !unifiedMessage) {
      template = await getTemplate(
        context.tenantId,
        context.messageTypeId,
        'email',
        preferredLanguage
      );
    }
    
    // 3. Handle direct message content (unified message that adapts to channels)
    if (isDirectMessage && unifiedMessage) {
      // Use provided subject if available, otherwise extract from first line/sentence of message
      const providedSubject = context.variables?._subject as string | undefined;
      const subject = providedSubject || extractSubject(unifiedMessage, 100) || `Message from ${messageTypeConfig.label}`;
      const htmlBody = unifiedMessage;
      const textBody = stripHtml(unifiedMessage);
      
      // PHASE 5.1: Check rate limits before sending
      const rateLimitCheck = await checkRateLimits({
        tenantId: context.tenantId,
        userId: context.userId,
        messageTypeId: context.messageTypeId,
        channel: 'email',
      });

      if (!rateLimitCheck.allowed && 'reason' in rateLimitCheck && 'details' in rateLimitCheck) {
        // Create log entry with suppressed status
        const logRef = db
          .collection('tenants')
          .doc(context.tenantId)
          .collection('messageLogs')
          .doc();
        
        await logRef.set({
          tenantId: context.tenantId,
          userId: context.userId,
          messageTypeId: context.messageTypeId,
          channel: 'email',
          direction: 'outbound',
          fromIdentity: 'system',
          contentSent: htmlBody,
          language: preferredLanguage,
          status: 'suppressed_rate_limit',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...outboundRecipientForChannel('email', userData),
        });
        
        return {
          channel: 'email',
          success: false,
          error: `Rate limit exceeded: ${rateLimitCheck.reason}`,
          suppressed: true,
        };
      }
      
      // PHASE 5.2: Check quiet hours
      const quietHoursCheck = await isQuietHours({
        tenantId: context.tenantId,
        messageTypeId: context.messageTypeId,
      });
      if (quietHoursCheck && !messageTypeConfig.critical) {
        // Create log entry with suppressed status
        const logRef = db
          .collection('tenants')
          .doc(context.tenantId)
          .collection('messageLogs')
          .doc();
        
        await logRef.set({
          tenantId: context.tenantId,
          userId: context.userId,
          messageTypeId: context.messageTypeId,
          channel: 'email',
          direction: 'outbound',
          fromIdentity: 'system',
          contentSent: htmlBody,
          language: preferredLanguage,
          status: 'suppressed_quiet_hours',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...outboundRecipientForChannel('email', userData),
        });
        
        return {
          channel: 'email',
          success: false,
          error: 'Message suppressed due to quiet hours',
          suppressed: true,
        };
      }
      
      // For signature lookup, use sender's userId (recruiter ID) if available, otherwise recipient's userId
      const signatureUserId = context.source === 'recruiter' && context.sourceId 
        ? context.sourceId 
        : (senderIdentity.gmailUserId || context.userId);
      
      // Send direct email (senderIdentity already resolved above)
      const result = await emailProvider.sendEmail({
        tenantId: context.tenantId,
        to: { email: userData.email, name: userData.displayName || userData.firstName },
        subject,
        htmlBody,
        textBody,
        messageTypeId: context.messageTypeId,
        userId: signatureUserId, // Use sender's ID for signature lookup
        fromEmail: senderIdentity.emailAddress,
        gmailUserId: senderIdentity.gmailUserId,
      });

      // Create or find email thread and add message
      if (result.success && result.providerMessageId) {
        try {
          const fromEmail = (senderIdentity.emailAddress || userData.email || '').toLowerCase();
          const toEmail = (userData.email || '').toLowerCase();
          
          if (!toEmail) {
            logger.warn(`Cannot create email thread: recipient email is missing for user ${context.userId}`);
          } else {
            logger.info(`Creating email thread for direct message: from=${fromEmail}, to=${toEmail}, subject=${subject}`);
            
            const thread = await findOrCreateEmailThread(context.tenantId, {
              subject,
              from: fromEmail,
              to: [toEmail],
            }, {
              userId: context.userId,
            });

            if (thread.id) {
              logger.info(`Email thread created/found: ${thread.id}, adding message`);
              await addMessageToThread(thread.id, context.tenantId, {
                direction: 'outbound',
                from: fromEmail,
                fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
                to: [toEmail],
                subject,
                bodyHtml: htmlBody,
                bodyPlain: textBody,
                bodySnippet: textBody.substring(0, 200),
                status: 'sent',
                providerMessageId: result.providerMessageId,
                read: true, // Outbound messages are auto-read
              });
              logger.info(`Message added to thread ${thread.id} successfully`);
            } else {
              logger.warn(`Email thread created but has no ID`);
            }
          }
        } catch (threadError: any) {
          // Don't fail email send if threading fails, but log the error
          logger.error(`Failed to create email thread for direct message:`, {
            error: threadError.message,
            stack: threadError.stack,
            userId: context.userId,
            tenantId: context.tenantId,
            subject,
          });
        }
      } else {
        logger.warn(`Email send failed or no providerMessageId, skipping thread creation. success=${result.success}, messageId=${result.providerMessageId}`);
      }
      
      return {
        channel: 'email',
        success: result.success,
        messageId: result.providerMessageId,
        error: result.errorMessage,
        status: result.success ? 'sent' : 'failed',
      };
    }
    
    // 4. Handle template-based message (existing logic)
    if (!template) {
      logger.warn(`No email template found for ${context.messageTypeId}/email/${preferredLanguage} in tenant ${context.tenantId}`);
      
      // For critical messages, use failsafe
      if (messageTypeConfig.critical) {
        const failsafeSubject = `Notification: ${messageTypeConfig.label}`;
        const failsafeBody = `You have a new ${messageTypeConfig.label.toLowerCase()}. Please check your account.`;
        
        // Send failsafe email (senderIdentity already resolved above)
        const result = await emailProvider.sendEmail({
          tenantId: context.tenantId,
          to: { email: userData.email, name: userData.displayName || userData.firstName },
          subject: failsafeSubject,
          htmlBody: failsafeBody,
          textBody: failsafeBody,
          messageTypeId: context.messageTypeId,
          userId: context.userId,
          fromEmail: senderIdentity.emailAddress,
          gmailUserId: senderIdentity.gmailUserId,
        });
        
        return {
          channel: 'email',
          success: result.success,
          messageId: result.providerMessageId,
          error: result.errorMessage,
          status: result.success ? 'sent' : 'failed',
        };
      } else {
        // Non-critical: don't send
        return {
          channel: 'email',
          success: false,
          error: 'Template not found and message is not critical',
        };
      }
    }
    
    // 2. Build template context
    const templateContext = {
      userId: context.userId,
      userData,
      tenantId: context.tenantId,
      ...context.variables,
    } as TemplateVariableContext;
    
    // Resolve variables
    const variables = await resolveTemplateVariables(templateContext);
    
    // 3. Render template (use HTML body for email when present so variables and links render correctly)
    const renderedBody = await renderTemplate(template, variables, context.tenantId);
    const renderedHtmlBody = template.htmlBody
      ? renderTemplateHtmlBody(template, variables)
      : renderedBody;

    // 4. Get subject (pre-rendered from dispatcher, or from template); render placeholders when from template
    let subject = context.variables?._subject ??
                   context.variables?.subject ??
                   template.subject ??
                   template.name ??
                   `Notification: ${messageTypeConfig.label}`;
    if (typeof subject === 'string' && (context.variables?._subject == null && context.variables?.subject == null)) {
      subject = renderStringWithVariables(subject, variables);
    }
    
    // PHASE 5.1: Check rate limits before sending
    const rateLimitCheck = await checkRateLimits({
      tenantId: context.tenantId,
      userId: context.userId,
      messageTypeId: context.messageTypeId,
      channel: 'email',
    });

    if (!rateLimitCheck.allowed && 'reason' in rateLimitCheck && 'details' in rateLimitCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'email',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: renderedBody,
        contentSent: renderedHtmlBody,
        language: preferredLanguage,
        status: 'suppressed_rate_limit',
        failureReason: JSON.stringify(rateLimitCheck.details),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...outboundRecipientForChannel('email', userData),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`Email suppressed due to rate limit for user ${context.userId}: ${rateLimitCheck.reason}`);
      
      return {
        channel: 'email',
        success: false,
        suppressed: true,
        error: `Rate limit exceeded: ${rateLimitCheck.reason}`,
      };
    }

    // PHASE 5.2: Check quiet hours before sending
    const quietHoursCheck = await isQuietHours({
      tenantId: context.tenantId,
      messageTypeId: context.messageTypeId,
    });

    if (quietHoursCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'email',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: renderedBody,
        contentSent: renderedHtmlBody,
        language: preferredLanguage,
        status: 'suppressed_quiet_hours',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...outboundRecipientForChannel('email', userData),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`Email suppressed due to quiet hours for user ${context.userId}`);
      
      return {
        channel: 'email',
        success: false,
        suppressed: true,
        error: 'Message suppressed due to quiet hours',
      };
    }

    // 5. Create initial log entry (status: queued)
    const logRef = db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('messageLogs')
      .doc();
    
    const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
      createdAt: admin.firestore.FieldValue;
    } = {
      tenantId: context.tenantId,
      userId: context.userId,
      threadId: context.metadata?.threadId || undefined,
      messageTypeId: context.messageTypeId,
      channel: 'email',
      direction: 'outbound',
      fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
      fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
      contentOriginal: renderedBody,
      contentSent: renderedHtmlBody,
      language: preferredLanguage,
      status: 'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...outboundRecipientForChannel('email', userData),
    };
    
    await logRef.set(logDoc);
    
    // 6. Send via EmailProvider (Phase 4 spec interface)
    const toEmail = userData.email;
    const toName = userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || undefined;
    
    // Resolve sender identity for template-based emails (reuse if already resolved, otherwise resolve now)
    let templateSenderIdentity = senderIdentity;
    if (!templateSenderIdentity) {
      templateSenderIdentity = await resolveSenderIdentity(context.tenantId, context);
    }
    
    // For signature lookup, use sender's userId (recruiter ID) if available, otherwise recipient's userId
    const signatureUserId = context.source === 'recruiter' && context.sourceId 
      ? context.sourceId 
      : (templateSenderIdentity.gmailUserId || context.userId);
    
    const result = await emailProvider.sendEmail({
      tenantId: context.tenantId,
      to: { email: toEmail, name: toName },
      subject,
      htmlBody: renderedHtmlBody,
      textBody: context.variables?.textBody || stripHtml(renderedBody),
      messageTypeId: context.messageTypeId,
      userId: signatureUserId, // Use sender's ID for signature lookup
      fromEmail: templateSenderIdentity.emailAddress,
      gmailUserId: templateSenderIdentity.gmailUserId,
    });
    
    // 7. Create or find email thread and add message (if sent successfully)
    let threadId: string | undefined = context.metadata?.threadId;
    if (result.success && result.providerMessageId && !threadId) {
      try {
        const fromEmail = templateSenderIdentity.emailAddress || toEmail;
        const thread = await findOrCreateEmailThread(context.tenantId, {
          subject,
          from: fromEmail,
          to: [toEmail.toLowerCase()],
        }, {
          userId: context.userId,
        });

        if (thread.id) {
          threadId = thread.id;
          await addMessageToThread(thread.id, context.tenantId, {
            direction: 'outbound',
            from: fromEmail,
            fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
            to: [toEmail.toLowerCase()],
            subject,
            bodyHtml: renderedHtmlBody,
            bodyPlain: context.variables?.textBody || stripHtml(renderedBody),
            bodySnippet: (context.variables?.textBody || stripHtml(renderedBody)).substring(0, 200),
            status: 'sent',
            providerMessageId: result.providerMessageId,
            read: true, // Outbound messages are auto-read
          });
        }
      } catch (threadError: any) {
        // Don't fail email send if threading fails
        logger.error(`Failed to create email thread for template message: ${threadError.message}`);
      }
    }
    
    // 8. Update log with final status and threadId
    const update: any = {
      status: result.success ? 'sent' : 'failed',
    };
    
    if (threadId) {
      update.threadId = threadId;
    }
    if (result.providerMessageId) {
      update.providerMessageId = result.providerMessageId;
    }
    if (!result.success) {
      update.failureReason = result.errorMessage || result.errorCode;
    }
    
    await logRef.update(update);
    
    logger.info(`Email ${result.success ? 'sent' : 'failed'} for ${context.messageTypeId} to user ${context.userId}: ${result.providerMessageId || result.errorMessage}`);
    
    return {
      channel: 'email',
      success: result.success,
      messageId: result.providerMessageId,
      error: result.errorMessage,
      status: result.success ? 'sent' : 'failed',
    };
  } catch (error: any) {
    logger.error(`Error delivering email for ${context.messageTypeId}:`, error);
    return {
      channel: 'email',
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Strip HTML tags for plain text fallback
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Deliver push notification
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 2.4 Wire Push into Orchestrator
 */
async function deliverPush(
  context: MessageContext,
  messageTypeConfig: MessageTypeConfig,
  userData: admin.firestore.DocumentData
): Promise<DeliveryResult> {
  try {
    // Import template functions
    const { resolveTemplateVariables } = await import('../utils/templateVariableResolver');
    
    // Get user's preferred language
    const preferredLanguage = (userData.preferredLanguage || 'en') as 'en' | 'es';
    
    // 1. Get device tokens for user
    const deviceTokens = await getDeviceTokensForUser(context.userId);
    if (!deviceTokens || deviceTokens.length === 0) {
      logger.info(`No device tokens found for user ${context.userId}, skipping push`);
      return {
        channel: 'push',
        success: false,
        error: 'No device tokens for user',
      };
    }
    
    // 2. Resolve push template (or derive title/body from unified message)
    let title = '';
    let body = '';
    
    // Check if this is a direct message with unified content
    const isDirectMessage = context.variables?._directMessage === true || !messageTypeConfig.requiresTemplate;
    const unifiedMessage = context.variables?._message as string | undefined;
    
    // Helper function to strip HTML
    const stripHtml = (html: string): string => {
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    };
    
    // Helper function to extract title from message (first line or first sentence)
    const extractTitle = (html: string, maxLength: number = 50): string => {
      const text = stripHtml(html);
      // Try to get first sentence (ends with . ! or ?)
      const firstSentenceMatch = text.match(/^[^.!?]+[.!?]/);
      if (firstSentenceMatch) {
        return firstSentenceMatch[0].trim().substring(0, maxLength);
      }
      // Otherwise get first line
      const firstLine = text.split('\n')[0].trim();
      return firstLine.substring(0, maxLength);
    };
    
    if (isDirectMessage && unifiedMessage) {
      // Use provided subject/title if available, otherwise extract from first line/sentence
      const providedSubject = context.variables?._subject as string | undefined;
      title = providedSubject || extractTitle(unifiedMessage, 50) || messageTypeConfig.label;
      // Use rest of message as body (strip HTML, limit to reasonable length)
      const textBody = stripHtml(unifiedMessage);
      // Remove the title part from body if it's at the start
      const titleInBody = textBody.startsWith(title);
      body = titleInBody ? textBody.substring(title.length).trim() : textBody;
      // Limit body length for push notifications (typically 200-300 chars)
      if (body.length > 200) {
        body = body.substring(0, 197) + '...';
      }
    } else {
      // Use template-based approach
      const template = await getTemplate(
        context.tenantId,
        context.messageTypeId,
        'push',
        preferredLanguage
      );
      
      if (template) {
        // Build template context
        const templateContext = {
          userId: context.userId,
          userData,
          tenantId: context.tenantId,
          ...context.variables,
        } as TemplateVariableContext;
        
        // Resolve variables
        const variables = await resolveTemplateVariables(templateContext);
        
        // Render template
        const renderedBody = await renderTemplate(template, variables, context.tenantId);
        
        // For push, use template name as title, body as notification body
        title = template.name || messageTypeConfig.label;
        body = stripHtml(renderedBody);
      } else {
        // Fallback: derive from message type
        title = messageTypeConfig.label;
        body = context.variables?.message || `You have a new ${messageTypeConfig.label.toLowerCase()}.`;
      }
    }
    
    // PHASE 5.1: Check rate limits before sending
    const rateLimitCheck = await checkRateLimits({
      tenantId: context.tenantId,
      userId: context.userId,
      messageTypeId: context.messageTypeId,
      channel: 'push',
    });

    if (!rateLimitCheck.allowed && 'reason' in rateLimitCheck && 'details' in rateLimitCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'push',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: body,
        contentSent: body,
        language: preferredLanguage,
        status: 'suppressed_rate_limit',
        failureReason: JSON.stringify(rateLimitCheck.details),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`Push suppressed due to rate limit for user ${context.userId}: ${rateLimitCheck.reason}`);
      
      return {
        channel: 'push',
        success: false,
        suppressed: true,
        error: `Rate limit exceeded: ${rateLimitCheck.reason}`,
      };
    }

    // PHASE 5.2: Check quiet hours before sending
    const quietHoursCheck = await isQuietHours({
      tenantId: context.tenantId,
      messageTypeId: context.messageTypeId,
    });

    if (quietHoursCheck) {
      // Create log entry with suppressed status
      const logRef = db
        .collection('tenants')
        .doc(context.tenantId)
        .collection('messageLogs')
        .doc();
      
      const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
        createdAt: admin.firestore.FieldValue;
      } = {
        tenantId: context.tenantId,
        userId: context.userId,
        threadId: context.metadata?.threadId || undefined,
        messageTypeId: context.messageTypeId,
        channel: 'push',
        direction: 'outbound',
        fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentOriginal: body,
        contentSent: body,
        language: preferredLanguage,
        status: 'suppressed_quiet_hours',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      
      await logRef.set(logDoc);
      
      logger.info(`Push suppressed due to quiet hours for user ${context.userId}`);
      
      return {
        channel: 'push',
        success: false,
        suppressed: true,
        error: 'Message suppressed due to quiet hours',
      };
    }

    // 3. Create initial log entry (status: queued)
    const logRef = db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('messageLogs')
      .doc();
    
    const logDoc: Omit<MessageLog, 'id' | 'createdAt'> & {
      createdAt: admin.firestore.FieldValue;
    } = {
      tenantId: context.tenantId,
      userId: context.userId,
      threadId: context.metadata?.threadId || undefined,
      messageTypeId: context.messageTypeId,
      channel: 'push',
      direction: 'outbound',
      fromIdentity: context.source === 'recruiter' ? 'recruiter' : 'system',
      fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
      contentOriginal: body,
      contentSent: body,
      language: preferredLanguage,
      status: 'queued',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    await logRef.set(logDoc);
    
    // 4. Persistent inbox: every push creates a notification doc so Inbox is the permanent record (worker Notification Center).
    const deepLink = context.metadata?.ctaUrl ?? context.variables?.ctaUrl ?? '';
    const entityId = context.metadata?.assignmentId ?? context.metadata?.applicationId ?? context.metadata?.jobPostId ?? context.metadata?.entityId ?? '';
    const inboxType = context.messageTypeId === 'assignment_created' ? 'assignment'
      : (context.messageTypeId || '').startsWith('application_') ? 'application'
      : 'general';
    try {
      await writeWorkerInboxNotification({
        uid: context.userId,
        tenantId: context.tenantId,
        title,
        body,
        type: inboxType,
        deepLink: deepLink || undefined,
        entityId: entityId || undefined,
        source: 'automation',
      });
    } catch (inboxErr: any) {
      logger.warn('Failed to write worker inbox notification (push still sent)', { userId: context.userId, error: inboxErr?.message });
    }
    
    // 5. Send via PushProvider — include deepLink for SW notificationclick (HRX-FCM-Messaging-Complete)
    const pushProvider = getPushProvider();
    const result = await pushProvider.sendPush({
      tenantId: context.tenantId,
      targets: [{
        userId: context.userId,
        deviceTokens,
      }],
      title,
      body,
      data: {
        messageTypeId: context.messageTypeId,
        deepLink,
        entityId: entityId || '',
        ...context.metadata,
      },
      messageTypeId: context.messageTypeId,
    });
    
    // 6. Update log with final status
    const update: any = {
      status: result.success ? 'sent' : 'failed',
    };
    
    if (!result.success) {
      update.failureReason = result.errors ? JSON.stringify(result.errors) : 'Push send failed';
    }
    
    await logRef.update(update);
    
    logger.info(`Push ${result.success ? 'sent' : 'failed'} for ${context.messageTypeId} to user ${context.userId}: ${result.sentCount} sent, ${result.failedCount} failed`);
    
    return {
      channel: 'push',
      success: result.success,
      messageId: undefined, // Push doesn't have a single message ID
      error: result.failedCount > 0 ? `${result.failedCount} devices failed` : undefined,
      status: result.success ? 'sent' : 'failed',
    };
  } catch (error: any) {
    logger.error(`Error delivering push for ${context.messageTypeId}:`, error);
    return {
      channel: 'push',
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Get device tokens for a user — canonical path users/{uid}/pushTokens per HRX-FCM-Messaging-Complete
 */
async function getDeviceTokensForUser(userId: string): Promise<string[]> {
  try {
    const pushTokensSnap = await db
      .collection('users')
      .doc(userId)
      .collection('pushTokens')
      .where('enabled', '==', true)
      .get();

    const tokens: string[] = [];
    for (const docSnap of pushTokensSnap.docs) {
      const token = docSnap.data().token ?? docSnap.id;
      if (token) tokens.push(token);
    }
    return tokens;
  } catch (error: any) {
    logger.error(`Error fetching push tokens for user ${userId}:`, error);
    return [];
  }
}

/**
 * Log message attempt to unified message log
 */
async function logMessageAttempt(
  context: MessageContext,
  routingDecision: RoutingDecision,
  deliveryResults: DeliveryResult[],
  userData: admin.firestore.DocumentData
): Promise<string> {
  try {
    // Log each channel separately for better tracking
    const logIds: string[] = [];
    
    for (const result of deliveryResults) {
      // Get actual message content - prefer _message (unified message) or message from context
      let actualContent = context.variables?._message || context.variables?.message;
      
      // If we don't have content, try to construct a meaningful message
      if (!actualContent || actualContent === `Message: ${context.messageTypeId}`) {
        // For direct messages, the content should be in _message
        if (context.variables?._directMessage && context.variables?._message) {
          actualContent = context.variables._message;
        } else {
          // Fallback to placeholder
          actualContent = `Message: ${context.messageTypeId}`;
        }
      }
      
      const messageLog: Omit<MessageLog, 'id' | 'createdAt'> = {
        userId: context.userId,
        tenantId: context.tenantId,
        messageTypeId: context.messageTypeId,
        channel: result.channel,
        direction: 'outbound' as MessageDirection,
        fromIdentity: (context.source === 'recruiter' ? 'recruiter' : 'system') as MessageFromIdentity,
        fromUserId: context.source === 'recruiter' ? context.sourceId : undefined,
        contentSent: actualContent,
        contentOriginal: context.variables?._message || context.variables?.message, // Store original if different
        language: (context.variables?.language || 'en') as MessageLanguage,
        status: (result.success ? 'sent' : 'failed') as MessageStatus,
        failureReason: result.error,
        providerMessageId: result.messageId,
        ...outboundRecipientForChannel(result.channel, userData),
      };
      
      const logId = await logMessage(messageLog);
      if (logId) {
        logIds.push(logId);
      }
    }
    
    // If no channels were used, log the attempt anyway
    if (deliveryResults.length === 0 && !routingDecision.shouldSend) {
      // Get message type config for default channel
      const messageTypeConfig = await getMessageTypeConfig(context.tenantId, context.messageTypeId);
      const defaultCh = messageTypeConfig?.defaultChannels[0] || 'sms';
      const messageLog: Omit<MessageLog, 'id' | 'createdAt'> = {
        userId: context.userId,
        tenantId: context.tenantId,
        messageTypeId: context.messageTypeId,
        channel: defaultCh,
        direction: 'outbound' as MessageDirection,
        fromIdentity: 'system' as MessageFromIdentity,
        contentSent: `Message not sent: ${routingDecision.reason}`,
        language: 'en' as MessageLanguage,
        status: 'not_sent' as MessageStatus,
        failureReason: routingDecision.reason,
        ...outboundRecipientForChannel(defaultCh, userData),
      };
      
      const logId = await logMessage(messageLog);
      if (logId) {
        logIds.push(logId);
      }
    }
    
    return logIds[0] || '';
  } catch (error: any) {
    logger.error('Error logging message attempt:', error);
    // Don't throw - logging failure shouldn't break message delivery
    return '';
  }
}

