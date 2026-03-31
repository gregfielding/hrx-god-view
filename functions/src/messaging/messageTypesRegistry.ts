/**
 * Message Types Registry
 * 
 * Central registry for all message types in the HRX One unified messaging framework.
 * Defines message type configurations including channels, compliance rules, and AI permissions.
 * 
 * Based on: hrxone-unified-messaging-framework-v1.md Section 3
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

const db = admin.firestore();

export type Channel = 'sms' | 'email' | 'push';
export type MessageCategory = 'system' | 'transactional' | 'compliance' | 'engagement' | 'chat' | 'marketing';

export interface MessageTypeConfig {
  id: string;                     // e.g. "shift_confirmation"
  label: string;                  // Human-readable label
  category: MessageCategory;      // Message category
  defaultChannels: Channel[];     // Default channels for this type
  critical: boolean;              // If true, should strongly attempt delivery
  allowReply: boolean;            // Whether user can freely reply
  requiresExplicitSmsOptIn: boolean; // Almost always true
  requiresTemplate: boolean;      // True for system / transactional / compliance
  aiAllowedToDraft: boolean;      // Whether AI can propose content
  aiAllowedToAutoSend: boolean;   // ONLY for defined automation flows
  description?: string;            // Optional description
  enabled: boolean;                // Whether this message type is enabled
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
}

/**
 * Default message types registry
 * These are seeded into Firestore on first setup
 */
export const DEFAULT_MESSAGE_TYPES: MessageTypeConfig[] = [
  // System Messages
  {
    id: 'system_onboarding_welcome',
    label: 'System Onboarding Welcome',
    category: 'system',
    defaultChannels: ['sms'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Welcome message sent after user signup',
    enabled: true,
  },
  {
    id: 'system_alert',
    label: 'System Alert',
    category: 'system',
    defaultChannels: ['email', 'push'],
    critical: true,
    allowReply: false,
    requiresExplicitSmsOptIn: false,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'System alerts (password reset, security, etc.)',
    enabled: true,
  },
  
  // Transactional Messages
  {
    id: 'shift_confirmation',
    label: 'Shift Confirmation',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Confirmation when worker is assigned to a shift',
    enabled: true,
  },
  {
    id: 'shift_cancellation',
    label: 'Shift Cancellation',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Notification when a shift is cancelled',
    enabled: true,
  },
  {
    id: 'shift_reminder',
    label: 'Shift Reminder',
    category: 'transactional',
    defaultChannels: ['sms', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Reminder sent before shift starts',
    enabled: true,
  },
  {
    id: 'assignment_reminder_24h',
    label: 'Assignment Reminder (24h)',
    category: 'transactional',
    defaultChannels: ['sms', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Operational reminder sent 24 hours before confirmed assignment start',
    enabled: true,
  },
  {
    id: 'assignment_reminder_2h',
    label: 'Assignment Reminder (2h)',
    category: 'transactional',
    defaultChannels: ['sms', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Operational reminder sent 2 hours before confirmed assignment start',
    enabled: true,
  },
  {
    id: 'application_received',
    label: 'Application Received',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: false,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Confirmation when application is received',
    enabled: true,
  },
  {
    id: 'application_status_change',
    label: 'Application Status Change',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Notification when application status changes',
    enabled: true,
  },
  {
    id: 'application_waitlisted',
    label: 'Application Waitlisted',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when an application is waitlisted (e.g. "Hi {{firstName}}, you\'ve been waitlisted...")',
    enabled: true,
  },
  {
    id: 'application_offered',
    label: 'Application Offered',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when a worker receives an offer.',
    enabled: true,
  },
  {
    id: 'application_rejected',
    label: 'Application Not Accepted',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: false,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when an application is not accepted (e.g. "Unfortunately we won\'t need you for this role...")',
    enabled: true,
  },
  {
    id: 'application_requirements_reminder',
    label: 'Complete Your Application (requirements reminder)',
    category: 'transactional',
    defaultChannels: ['email', 'push'],
    critical: false,
    allowReply: false,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Reminder to complete missing requirements for a submitted application; sent once per application when backend detects missing items (e.g. 24h after submit).',
    enabled: true,
  },
  {
    id: 'assignment_created',
    label: 'Assignment Created',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Notification when worker is assigned to a job',
    enabled: true,
  },
  {
    id: 'assignment_status_change',
    label: 'Assignment Status Change',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Notification when assignment status changes',
    enabled: true,
  },
  {
    id: 'assignment_confirmed',
    label: 'Assignment Confirmed',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when worker confirms assignment.',
    enabled: true,
  },
  {
    id: 'assignment_cancelled',
    label: 'Assignment Cancelled',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when assignment is cancelled.',
    enabled: true,
  },
  {
    id: 'assignment_active',
    label: 'Assignment Active',
    category: 'transactional',
    defaultChannels: ['sms', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when assignment moves to active.',
    enabled: true,
  },
  {
    id: 'assignment_completed',
    label: 'Assignment Completed',
    category: 'transactional',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description: 'Sent when assignment is completed.',
    enabled: true,
  },
  {
    id: 'payroll_onboarding_invite_needed',
    label: 'Payroll Onboarding Invite Needed',
    category: 'transactional',
    defaultChannels: ['sms', 'email'],
    critical: true,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: true,
    description:
      'Sent when an assignment is confirmed and the worker needs the entity payroll onboarding URL (entities.payrollSettings.onboardingUrl). Body supplied in variables.message.',
    enabled: true,
  },
  
  // Compliance Messages
  {
    id: 'profile_incomplete_reminder',
    label: 'Profile Incomplete Reminder',
    category: 'compliance',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'Reminder to complete profile information',
    enabled: true,
  },
  {
    id: 'background_check_reminder',
    label: 'Background Check Reminder',
    category: 'compliance',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'Reminder about background check requirements',
    enabled: true,
  },
  {
    id: 'resume_upload_reminder',
    label: 'Resume Upload Reminder',
    category: 'compliance',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'Reminder to upload resume',
    enabled: true,
  },
  {
    id: 'work_eligibility_reminder',
    label: 'Work Eligibility Reminder',
    category: 'compliance',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'Reminder about work eligibility documentation',
    enabled: true,
  },
  {
    id: 'certification_expiring',
    label: 'Certification Expiring',
    category: 'compliance',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'Reminder about expiring certifications',
    enabled: true,
  },
  
  // Engagement Messages
  {
    id: 'recruiter_chat',
    label: 'Recruiter Chat',
    category: 'chat',
    defaultChannels: ['sms', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: false,
    description: 'Direct message from recruiter to candidate',
    enabled: true,
  },
  {
    id: 'bulk_message',
    label: 'Bulk Message',
    category: 'engagement',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: false,
    description: 'Bulk message to multiple recipients',
    enabled: true,
  },
  {
    id: 'direct_message',
    label: 'Direct Message',
    category: 'engagement',
    defaultChannels: ['sms', 'email', 'push'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: false, // Allows direct content without templates
    aiAllowedToDraft: false,
    aiAllowedToAutoSend: false,
    description: 'Direct message from recruiter/admin to user(s) with custom content',
    enabled: true,
  },
  {
    id: 'ai_outreach_nudge',
    label: 'AI Outreach Nudge',
    category: 'engagement',
    defaultChannels: ['sms', 'email'],
    critical: false,
    allowReply: true,
    requiresExplicitSmsOptIn: true,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: true,
    description: 'AI-generated outreach message (future)',
    enabled: false, // Disabled until AI features are ready
  },
  
  // Marketing Messages (if needed in future)
  {
    id: 'marketing_newsletter',
    label: 'Marketing Newsletter',
    category: 'marketing',
    defaultChannels: ['email'],
    critical: false,
    allowReply: false,
    requiresExplicitSmsOptIn: false,
    requiresTemplate: true,
    aiAllowedToDraft: true,
    aiAllowedToAutoSend: false,
    description: 'Marketing/newsletter emails (requires explicit opt-in)',
    enabled: false, // Disabled by default, requires explicit opt-in
  },
];

/**
 * Get message type configuration by ID
 */
export async function getMessageTypeConfig(
  tenantId: string,
  messageTypeId: string
): Promise<MessageTypeConfig | null> {
  try {
    const doc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTypes')
      .doc(messageTypeId)
      .get();
    
    if (!doc.exists) {
      // Return default if not found in tenant-specific config
      return DEFAULT_MESSAGE_TYPES.find(t => t.id === messageTypeId) || null;
    }
    
    return { id: doc.id, ...doc.data() } as MessageTypeConfig;
  } catch (error: any) {
    logger.error(`Error getting message type config for ${messageTypeId}:`, error);
    // Fallback to default
    return DEFAULT_MESSAGE_TYPES.find(t => t.id === messageTypeId) || null;
  }
}

/**
 * Get all message type configurations for a tenant
 */
export async function getAllMessageTypes(tenantId: string): Promise<MessageTypeConfig[]> {
  try {
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTypes')
      .get();
    
    const tenantTypes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as MessageTypeConfig[];
    
    // Merge with defaults (tenant configs override defaults)
    const defaultMap = new Map(DEFAULT_MESSAGE_TYPES.map(t => [t.id, t]));
    tenantTypes.forEach(t => defaultMap.set(t.id, t));
    
    return Array.from(defaultMap.values()).sort((a, b) => a.label.localeCompare(b.label));
  } catch (error: any) {
    logger.error(`Error getting all message types for tenant ${tenantId}:`, error);
    // Return defaults on error
    return DEFAULT_MESSAGE_TYPES;
  }
}

/**
 * Initialize message types for a tenant (seed defaults)
 */
export async function initializeMessageTypes(tenantId: string): Promise<void> {
  try {
    const batch = db.batch();
    const existingSnapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTypes')
      .get();
    
    const existingIds = new Set(existingSnapshot.docs.map(doc => doc.id));
    
    DEFAULT_MESSAGE_TYPES.forEach(type => {
      if (!existingIds.has(type.id)) {
        const ref = db
          .collection('tenants')
          .doc(tenantId)
          .collection('messageTypes')
          .doc(type.id);
        
        batch.set(ref, {
          ...type,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
    
    await batch.commit();
    logger.info(`Initialized message types for tenant ${tenantId}`);
  } catch (error: any) {
    logger.error(`Error initializing message types for tenant ${tenantId}:`, error);
    throw error;
  }
}

/**
 * Update message type configuration
 */
export async function updateMessageType(
  tenantId: string,
  messageTypeId: string,
  updates: Partial<MessageTypeConfig>
): Promise<void> {
  try {
    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTypes')
      .doc(messageTypeId);
    
    await ref.set({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    logger.info(`Updated message type ${messageTypeId} for tenant ${tenantId}`);
  } catch (error: any) {
    logger.error(`Error updating message type ${messageTypeId}:`, error);
    throw error;
  }
}

/**
 * Get message types by category
 */
export async function getMessageTypesByCategory(
  tenantId: string,
  category: MessageCategory
): Promise<MessageTypeConfig[]> {
  const allTypes = await getAllMessageTypes(tenantId);
  return allTypes.filter(t => t.category === category && t.enabled);
}

/**
 * Check if message type is enabled
 */
export async function isMessageTypeEnabled(
  tenantId: string,
  messageTypeId: string
): Promise<boolean> {
  const config = await getMessageTypeConfig(tenantId, messageTypeId);
  return config?.enabled ?? false;
}

