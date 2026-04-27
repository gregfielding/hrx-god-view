/**
 * SMS Template Management
 * CRUD operations for SMS templates used across all messaging scenarios
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export interface SmsTemplate {
  id?: string;
  tenantId: string;
  name: string;
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType?: 'applicationStatusChange' | 'applicationCreated' | 'assignmentCreated' | 'shiftCreated' | 'manual';
  triggerStatus?: string; // e.g., 'screened', 'advanced' (if triggerType is applicationStatusChange)
  messageTemplate: string; // "Hi {firstName}. Thank you for applying to be a {jobTitle} in {locationCity}."
  variables: string[]; // ['firstName', 'jobTitle', 'locationCity']
  enabled: boolean;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
  createdBy: string;
}

/**
 * Resolve template variables with actual data
 */
export function resolveTemplate(template: string, variables: Record<string, any>): string {
  let resolved = template;
  
  Object.keys(variables).forEach(key => {
    const value = variables[key];
    // Convert to string, handle null/undefined
    const stringValue = value != null ? String(value) : '';
    resolved = resolved.replace(new RegExp(`\\{${key}\\}`, 'g'), stringValue);
  });
  
  return resolved;
}

/**
 * Extract variables from template string
 */
export function extractVariables(template: string): string[] {
  const regex = /\{([^}]+)\}/g;
  const matches = template.matchAll(regex);
  const variables: string[] = [];
  
  for (const match of matches) {
    if (match[1] && !variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }
  
  return variables;
}

/**
 * Get all SMS templates for a tenant
 */
export const getSmsTemplates = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, category } = request.data as {
    tenantId: string;
    category?: SmsTemplate['category'];
  };

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
  }

  try {
    let templatesRef = db.collection(`tenants/${tenantId}/smsTemplates`);

    if (category) {
      templatesRef = templatesRef.where('category', '==', category) as any;
    }

    const snapshot = await templatesRef.get();
    const templates: SmsTemplate[] = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    })) as SmsTemplate[];

    return { success: true, templates };
  } catch (error: any) {
    logger.error('Error fetching SMS templates:', error);
    throw new HttpsError('internal', `Failed to fetch templates: ${error.message}`);
  }
});

/**
 * Create a new SMS template
 */
export const createSmsTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, template } = request.data as {
    tenantId: string;
    template: Omit<SmsTemplate, 'id' | 'createdAt' | 'updatedAt'>;
  };

  if (!tenantId || !template) {
    throw new HttpsError('invalid-argument', 'tenantId and template are required');
  }

  // Check permissions (Admin or Manager - security level 5+)
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  
  // Check tenant-specific security level first, then fallback to root
  const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
  const rootSecurityLevel = userData?.securityLevel;
  const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
  const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
  
  // Security levels 5, 6, 7 are Admin/Manager levels
  if (!securityLevel || securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Only admins and managers (security level 5+) can create templates');
  }

  try {
    // Extract variables from template
    const variables = extractVariables(template.messageTemplate);

    const templateData: Omit<SmsTemplate, 'id'> = {
      ...template,
      tenantId,
      variables,
      createdBy: request.auth.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp() as any,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() as any,
    };

    const docRef = await db.collection(`tenants/${tenantId}/smsTemplates`).add(templateData);

    logger.info(`SMS template created: ${docRef.id} by ${request.auth.uid}`);

    return {
      success: true,
      templateId: docRef.id,
      template: { id: docRef.id, ...templateData },
    };
  } catch (error: any) {
    logger.error('Error creating SMS template:', error);
    throw new HttpsError('internal', `Failed to create template: ${error.message}`);
  }
});

/**
 * Update an existing SMS template
 */
export const updateSmsTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, templateId, updates } = request.data as {
    tenantId: string;
    templateId: string;
    updates: Partial<SmsTemplate>;
  };

  if (!tenantId || !templateId || !updates) {
    throw new HttpsError('invalid-argument', 'tenantId, templateId, and updates are required');
  }

  // Check permissions (Admin or Manager - security level 5+)
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  
  // Check tenant-specific security level first, then fallback to root
  const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
  const rootSecurityLevel = userData?.securityLevel;
  const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
  const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
  
  // Security levels 5, 6, 7 are Admin/Manager levels
  if (!securityLevel || securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Only admins and managers (security level 5+) can update templates');
  }

  try {
    const templateRef = db.doc(`tenants/${tenantId}/smsTemplates/${templateId}`);
    
    // If messageTemplate is being updated, re-extract variables
    if (updates.messageTemplate) {
      updates.variables = extractVariables(updates.messageTemplate);
    }

    const updateData: any = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await templateRef.update(updateData);

    logger.info(`SMS template updated: ${templateId} by ${request.auth.uid}`);

    return { success: true };
  } catch (error: any) {
    logger.error('Error updating SMS template:', error);
    throw new HttpsError('internal', `Failed to update template: ${error.message}`);
  }
});

/**
 * Delete an SMS template
 */
export const deleteSmsTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, templateId } = request.data as {
    tenantId: string;
    templateId: string;
  };

  if (!tenantId || !templateId) {
    throw new HttpsError('invalid-argument', 'tenantId and templateId are required');
  }

  // Check permissions (Admin or Manager - security level 5+)
  const userDoc = await db.doc(`users/${request.auth.uid}`).get();
  const userData = userDoc.data();
  
  // Check tenant-specific security level first, then fallback to root
  const tenantSecurityLevel = userData?.tenantIds?.[tenantId]?.securityLevel;
  const rootSecurityLevel = userData?.securityLevel;
  const securityLevelStr = tenantSecurityLevel || rootSecurityLevel || '0';
  const securityLevel = typeof securityLevelStr === 'string' ? parseInt(securityLevelStr) : securityLevelStr;
  
  // Security levels 5, 6, 7 are Admin/Manager levels
  if (!securityLevel || securityLevel < 5) {
    throw new HttpsError('permission-denied', 'Only admins and managers (security level 5+) can delete templates');
  }

  try {
    await db.doc(`tenants/${tenantId}/smsTemplates/${templateId}`).delete();

    logger.info(`SMS template deleted: ${templateId} by ${request.auth.uid}`);

    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting SMS template:', error);
    throw new HttpsError('internal', `Failed to delete template: ${error.message}`);
  }
});

/**
 * Preview a template with sample data
 */
export const previewSmsTemplate = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { template, sampleData } = request.data as {
    template: string;
    sampleData?: Record<string, any>;
  };

  if (!template) {
    throw new HttpsError('invalid-argument', 'Template is required');
  }

  try {
    // Default sample data (matches standardized variables)
    const defaults: Record<string, any> = {
      // User variables
      firstName: 'John',
      lastName: 'Doe',
      fullName: 'John Doe',
      email: 'john.doe@example.com',
      phone: '+17025550147',
      
      // Job variables
      jobTitle: 'Server',
      jobOrderId: 'JO-12345',
      jobOrderName: 'Q4 Server Staffing',
      jobPostId: 'POST-67890',
      jobPostTitle: 'Server Position - Las Vegas',
      
      // Location variables
      locationCity: 'Las Vegas',
      locationState: 'NV',
      locationName: 'Main Location',
      locationAddress: '123 Main St, Las Vegas, NV',
      locationZipCode: '89101',
      
      // Company variables
      companyName: 'Acme Restaurant Group',
      
      // Application variables
      applicationId: 'APP-001',
      applicationStatus: 'Screened',
      applicationDate: new Date().toLocaleDateString(),
      
      // Assignment variables
      assignmentId: 'ASSIGN-001',
      assignmentStatus: 'Confirmed',
      assignmentDate: new Date().toLocaleDateString(),
      assignmentTimeRange: '9:00 AM - 5:00 PM',
      
      // Shift variables
      shiftId: 'SHIFT-001',
      shiftDate: new Date().toLocaleDateString(),
      shiftTimeRange: '8:00 AM - 4:00 PM',
      shiftStartTime: '8:00 AM',
      shiftEndTime: '4:00 PM',
      
      // Tenant variables
      tenantName: 'HRX Staffing',
      
      // Allow custom overrides
      ...sampleData,
    };

    const resolved = resolveTemplate(template, defaults);

    return {
      success: true,
      preview: resolved,
      variables: extractVariables(template),
    };
  } catch (error: any) {
    logger.error('Error previewing template:', error);
    throw new HttpsError('internal', `Failed to preview template: ${error.message}`);
  }
});

