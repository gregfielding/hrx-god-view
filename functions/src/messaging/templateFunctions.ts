/**
 * Cloud Functions for Template Engine Management
 * 
 * Provides callable functions for admin UI to manage templates
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 1.7 Admin UI Sketch
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  getTemplate,
  createTemplate,
  updateTemplate,
  getTemplatesByMessageType,
  previewTemplate,
  MessageTemplate,
  LanguageCode,
} from './templateEngine';
import { Channel } from './messageTypesRegistry';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Get template for message type, channel, and language
 */
export const getMessageTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, messageTypeId, channel, language } = request.data as {
    tenantId: string;
    messageTypeId: string;
    channel: Channel;
    language?: LanguageCode;
  };

  if (!tenantId || !messageTypeId || !channel) {
    throw new HttpsError('invalid-argument', 'tenantId, messageTypeId, and channel are required');
  }

  try {
    // Check permissions (Admin or Manager - security level 5+)
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    if (!userData) {
      throw new HttpsError('not-found', 'User not found');
    }

    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
    
    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins and managers can view templates');
    }

    const template = await getTemplate(tenantId, messageTypeId, channel, language || 'en');
    return { success: true, template };
  } catch (error: any) {
    logger.error('Error getting template:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get template: ${error.message}`);
  }
});

/**
 * Create a new template
 */
export const createMessageTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, template } = request.data as {
    tenantId: string;
    template: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'variables'>;
  };

  if (!tenantId || !template) {
    throw new HttpsError('invalid-argument', 'tenantId and template are required');
  }

  try {
    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    if (!userData) {
      throw new HttpsError('not-found', 'User not found');
    }

    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
    
    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins and managers can create templates');
    }

    const templateId = await createTemplate(tenantId, {
      ...template,
      createdBy: request.auth.uid,
    });

    return { success: true, templateId };
  } catch (error: any) {
    logger.error('Error creating template:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to create template: ${error.message}`);
  }
});

/**
 * Update an existing template
 */
export const updateMessageTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, templateId, updates } = request.data as {
    tenantId: string;
    templateId: string;
    updates: Partial<Omit<MessageTemplate, 'id' | 'createdAt' | 'version'>> & { incrementVersion?: boolean };
  };

  if (!tenantId || !templateId || !updates) {
    throw new HttpsError('invalid-argument', 'tenantId, templateId, and updates are required');
  }

  try {
    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    if (!userData) {
      throw new HttpsError('not-found', 'User not found');
    }

    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
    
    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins and managers can update templates');
    }

    await updateTemplate(tenantId, templateId, updates);
    return { success: true };
  } catch (error: any) {
    logger.error('Error updating template:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to update template: ${error.message}`);
  }
});

/**
 * Get all templates for a message type
 */
export const getMessageTemplates = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, messageTypeId, channel, language, activeOnly } = request.data as {
    tenantId: string;
    messageTypeId: string;
    channel?: Channel;
    language?: LanguageCode;
    activeOnly?: boolean;
  };

  if (!tenantId || !messageTypeId) {
    throw new HttpsError('invalid-argument', 'tenantId and messageTypeId are required');
  }

  try {
    // Check permissions
    const userDoc = await db.doc(`users/${request.auth.uid}`).get();
    const userData = userDoc.data();
    
    if (!userData) {
      throw new HttpsError('not-found', 'User not found');
    }

    const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
    const rootSecurityLevel = userData?.securityLevel;
    const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
    const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
    
    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins and managers can view templates');
    }

    const templates = await getTemplatesByMessageType(tenantId, messageTypeId, {
      channel,
      language,
      activeOnly,
    });

    return { success: true, templates };
  } catch (error: any) {
    logger.error('Error getting templates:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get templates: ${error.message}`);
  }
});

/**
 * Preview template with sample data
 */
export const previewMessageTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { template, sampleData, tenantId } = request.data as {
    template: MessageTemplate;
    sampleData?: Record<string, any>;
    tenantId?: string;
  };

  if (!template) {
    throw new HttpsError('invalid-argument', 'Template is required');
  }

  try {
    const preview = await previewTemplate(template, sampleData, tenantId);
    return { success: true, preview };
  } catch (error: any) {
    logger.error('Error previewing template:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to preview template: ${error.message}`);
  }
});

