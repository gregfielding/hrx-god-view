/**
 * Template Engine
 * 
 * Unified template system for SMS, Email, and Push notifications.
 * Supports per-channel and per-language variants with variable resolution.
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 1 Template Engine
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { Channel } from './messageTypesRegistry';

const db = admin.firestore();

export type LanguageCode = 'en' | 'es';

export interface MessageTemplate {
  id?: string;
  messageTypeId: string;         // FK into MessageTypesRegistry
  channel: Channel;
  language: LanguageCode;
  name: string;                  // Human readable, e.g., "Shift Confirmation (EN/SMS)"
  body: string;                  // "Hi {{firstName}}, your shift at {{location}}..."
  variables: string[];           // ["firstName","location","shiftStart","shiftEnd"]
  includeStopFooter: boolean;    // For SMS: auto-append STOP/HELP
  active: boolean;
  version: number;
  createdBy: string;             // userId or "system"
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
  // Optional fields for future
  subject?: string;              // For email
  htmlBody?: string;             // For email HTML
}

export interface SmsFooterConfig {
  stopText: string; // "Reply STOP to unsubscribe, HELP for help."
}

/**
 * Default SMS footer text
 */
const DEFAULT_SMS_FOOTER: SmsFooterConfig = {
  stopText: 'Reply STOP to unsubscribe, HELP for help.',
};

/**
 * Get SMS footer configuration
 */
async function getSmsFooterConfig(tenantId: string): Promise<SmsFooterConfig> {
  try {
    const configDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messagingConfig')
      .doc('smsFooter')
      .get();
    
    if (configDoc.exists) {
      return configDoc.data() as SmsFooterConfig;
    }
    
    return DEFAULT_SMS_FOOTER;
  } catch (error: any) {
    logger.warn(`Error getting SMS footer config for tenant ${tenantId}, using default:`, error);
    return DEFAULT_SMS_FOOTER;
  }
}

/**
 * Get template for message type, channel, and language
 * 
 * Resolution order:
 * 1. Exact match: (messageTypeId, channel, preferredLanguage)
 * 2. Fallback 1: (messageTypeId, channel, "en")
 * 3. Fallback 2: (messageTypeId, channel, any active template)
 */
export async function getTemplate(
  tenantId: string,
  messageTypeId: string,
  channel: Channel,
  language: LanguageCode = 'en'
): Promise<MessageTemplate | null> {
  try {
    // Try exact match first
    let template = await getTemplateExact(tenantId, messageTypeId, channel, language);
    if (template) {
      return template;
    }
    
    // Fallback to English
    if (language !== 'en') {
      template = await getTemplateExact(tenantId, messageTypeId, channel, 'en');
      if (template) {
        logger.info(`Template fallback: using EN template for ${messageTypeId}/${channel} (requested ${language})`);
        return template;
      }
    }
    
    // Fallback to any active template for this type/channel
    template = await getTemplateAnyLanguage(tenantId, messageTypeId, channel);
    if (template) {
      logger.info(`Template fallback: using ${template.language} template for ${messageTypeId}/${channel}`);
      return template;
    }
    
    logger.warn(`No template found for ${messageTypeId}/${channel}/${language} in tenant ${tenantId}`);
    return null;
  } catch (error: any) {
    logger.error(`Error getting template for ${messageTypeId}/${channel}/${language}:`, error);
    return null;
  }
}

/**
 * Get template with exact match
 */
async function getTemplateExact(
  tenantId: string,
  messageTypeId: string,
  channel: Channel,
  language: LanguageCode
): Promise<MessageTemplate | null> {
  try {
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .where('messageTypeId', '==', messageTypeId)
      .where('channel', '==', channel)
      .where('language', '==', language)
      .where('active', '==', true)
      .orderBy('version', 'desc')
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return null;
    }
    
    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as MessageTemplate;
  } catch (error: any) {
    logger.error(`Error getting exact template:`, error);
    return null;
  }
}

/**
 * Get template in any language (fallback)
 */
async function getTemplateAnyLanguage(
  tenantId: string,
  messageTypeId: string,
  channel: Channel
): Promise<MessageTemplate | null> {
  try {
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .where('messageTypeId', '==', messageTypeId)
      .where('channel', '==', channel)
      .where('active', '==', true)
      .orderBy('version', 'desc')
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return null;
    }
    
    const doc = snapshot.docs[0];
    return {
      id: doc.id,
      ...doc.data(),
    } as MessageTemplate;
  } catch (error: any) {
    logger.error(`Error getting any-language template:`, error);
    return null;
  }
}

/**
 * Render template with context variables
 * 
 * Implements: HRX One Messaging Phase 2 Spec — Section 1.5 Template Rendering
 */
export function renderTemplate(
  template: MessageTemplate,
  context: Record<string, any>,
  tenantId?: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      // Fill in any missing variables with '' (avoids failing when template uses new vars before functions redeploy)
      const mergedContext = { ...context };
      for (const varName of template.variables || []) {
        if (!(varName in mergedContext) || mergedContext[varName] == null) {
          mergedContext[varName] = '';
        }
      }
      
      // Render template body
      let rendered = template.body;
      
      // Replace variables: support both {{variableName}} and {variableName} (single-brace used by some templates)
      for (const [key, value] of Object.entries(mergedContext)) {
        const stringValue = value != null ? String(value) : '';
        const doublePlaceholder = `{{${key}}}`;
        const doubleEscaped = doublePlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rendered = rendered.replace(new RegExp(doubleEscaped, 'g'), stringValue);
        // Single-brace {key} (in case template was stored or authored with single braces)
        const keyEscaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rendered = rendered.replace(new RegExp(`\\{${keyEscaped}\\}`, 'g'), stringValue);
      }
      
      // Check for unreplaced variables (warn but don't fail) — both {{x}} and {x}
      const unreplacedDouble = rendered.match(/\{\{([^}]+)\}\}/g);
      const unreplacedSingle = rendered.match(/\{(?!\{)([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g);
      if (unreplacedDouble?.length) {
        logger.warn(`Template ${template.id} has unreplaced variables: ${unreplacedDouble.join(', ')}`);
      }
      if (unreplacedSingle?.length) {
        logger.warn(`Template ${template.id} has unreplaced single-brace variables: ${unreplacedSingle.join(', ')}`);
      }
      
      // Add STOP footer if needed
      if (template.includeStopFooter && template.channel === 'sms') {
        const footerConfig = tenantId ? await getSmsFooterConfig(tenantId) : DEFAULT_SMS_FOOTER;
        
        // Only append if not already present
        if (!rendered.includes(footerConfig.stopText)) {
          rendered = `${rendered} ${footerConfig.stopText}`;
        }
        
        // Enforce SMS length limit (1600 chars for concatenated SMS)
        if (rendered.length > 1600) {
          logger.warn(`Rendered SMS template exceeds 1600 chars, truncating: ${template.id}`);
          rendered = rendered.substring(0, 1597) + '...';
        }
      }
      
      resolve(rendered);
    } catch (error: any) {
      logger.error(`Error rendering template ${template.id}:`, error);
      reject(error);
    }
  });
}

/**
 * Extract variables from template body
 */
export function extractTemplateVariables(body: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = body.matchAll(regex);
  const variables: string[] = [];
  
  for (const match of matches) {
    const varName = match[1].trim();
    if (varName && !variables.includes(varName)) {
      variables.push(varName);
    }
  }
  
  return variables;
}

/**
 * Create a new template
 */
export async function createTemplate(
  tenantId: string,
  template: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'variables'>
): Promise<string> {
  try {
    // Auto-extract variables from body, htmlBody, and subject
    const variables = extractTemplateVariables(
      [template.body, template.htmlBody, template.subject].filter(Boolean).join(' ')
    );
    
    const templateData: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt'> & {
      createdAt: admin.firestore.FieldValue;
      updatedAt: admin.firestore.FieldValue;
    } = {
      ...template,
      variables,
      version: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    const docRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .add(templateData);
    
    logger.info(`Template created: ${docRef.id} for ${template.messageTypeId}/${template.channel}/${template.language}`);
    return docRef.id;
  } catch (error: any) {
    logger.error(`Error creating template:`, error);
    throw error;
  }
}

/**
 * Update an existing template
 */
export async function updateTemplate(
  tenantId: string,
  templateId: string,
  updates: Partial<Omit<MessageTemplate, 'id' | 'createdAt' | 'version'>> & { incrementVersion?: boolean }
): Promise<void> {
  try {
    const templateRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .doc(templateId);
    
    const currentTemplate = await templateRef.get();
    if (!currentTemplate.exists) {
      throw new Error(`Template ${templateId} not found`);
    }
    
    const currentData = currentTemplate.data() as MessageTemplate;
    const updateData: any = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    // Re-extract variables if body, htmlBody, or subject changed
    if (updates.body || updates.htmlBody || updates.subject) {
      const combinedText = [
        updates.body || currentData.body,
        updates.htmlBody || currentData.htmlBody,
        updates.subject || currentData.subject,
      ].filter(Boolean).join(' ');
      updateData.variables = extractTemplateVariables(combinedText);
    }
    
    // Increment version if requested
    if (updates.incrementVersion) {
      updateData.version = (currentData.version || 1) + 1;
      delete updateData.incrementVersion;
    }
    
    await templateRef.update(updateData);
    logger.info(`Template updated: ${templateId}`);
  } catch (error: any) {
    logger.error(`Error updating template ${templateId}:`, error);
    throw error;
  }
}

/**
 * Permanently delete a template
 */
export async function deleteTemplate(
  tenantId: string,
  templateId: string
): Promise<void> {
  const templateRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('messageTemplates')
    .doc(templateId);
  const doc = await templateRef.get();
  if (!doc.exists) {
    throw new Error(`Template ${templateId} not found`);
  }
  await templateRef.delete();
  logger.info(`Template deleted: ${templateId}`);
}

/**
 * Get all templates for a message type
 */
export async function getTemplatesByMessageType(
  tenantId: string,
  messageTypeId: string,
  options?: {
    channel?: Channel;
    language?: LanguageCode;
    activeOnly?: boolean;
  }
): Promise<MessageTemplate[]> {
  try {
    let query: admin.firestore.Query = db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .where('messageTypeId', '==', messageTypeId);
    
    if (options?.channel) {
      query = query.where('channel', '==', options.channel);
    }
    
    if (options?.language) {
      query = query.where('language', '==', options.language);
    }
    
    if (options?.activeOnly !== false) {
      query = query.where('active', '==', true);
    }
    
    query = query.orderBy('version', 'desc');
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as MessageTemplate[];
  } catch (error: any) {
    logger.error(`Error getting templates for message type ${messageTypeId}:`, error);
    throw error;
  }
}

/**
 * Preview template with sample data
 */
export async function previewTemplate(
  template: MessageTemplate,
  sampleData?: Record<string, any>,
  tenantId?: string
): Promise<string> {
  // Use sample data or defaults
  const defaultSampleData: Record<string, any> = {
    firstName: 'John',
    lastName: 'Doe',
    fullName: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+17025550147',
    jobTitle: 'Server',
    locationCity: 'Las Vegas',
    locationState: 'NV',
    locationName: 'Main Location',
    shiftDate: new Date().toLocaleDateString(),
    shiftStartTime: '8:00 AM',
    shiftEndTime: '4:00 PM',
    ...sampleData,
  };
  
  return await renderTemplate(template, defaultSampleData, tenantId);
}

