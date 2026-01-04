/**
 * Template Migration Helper
 * 
 * Utilities for migrating legacy SMS templates to the new unified template system.
 * 
 * Phase 2.1: Migration from /tenants/{tenantId}/smsTemplates to /tenants/{tenantId}/messageTemplates
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';
import { MessageTemplate } from './templateEngine';

const db = admin.firestore();

/**
 * Legacy SMS Template structure
 */
export interface LegacySmsTemplate {
  id?: string;
  tenantId: string;
  name: string;
  category: 'application' | 'assignment' | 'shift' | 'bulk' | 'semiAutomated' | 'fullyAutomated';
  triggerType?: 'applicationStatusChange' | 'applicationCreated' | 'assignmentCreated' | 'shiftCreated' | 'manual';
  triggerStatus?: string;
  messageTemplate: string;
  variables: string[];
  enabled: boolean;
  createdAt?: admin.firestore.Timestamp;
  updatedAt?: admin.firestore.Timestamp;
  createdBy: string;
}

/**
 * Map legacy template category/triggerType to messageTypeId
 */
function mapLegacyToMessageType(
  category: LegacySmsTemplate['category'],
  triggerType?: string,
  triggerStatus?: string
): string {
  // Map legacy categories to new message types
  if (category === 'application') {
    if (triggerType === 'applicationCreated') {
      return 'application_received';
    } else if (triggerType === 'applicationStatusChange') {
      // Map status to message type
      if (triggerStatus === 'screened') return 'application_screened';
      if (triggerStatus === 'advanced') return 'application_advanced';
      if (triggerStatus === 'hired') return 'application_hired';
      if (triggerStatus === 'rejected') return 'application_rejected';
      return 'application_status_update';
    }
  } else if (category === 'assignment') {
    if (triggerType === 'assignmentCreated') {
      return 'assignment_created';
    }
    return 'assignment_update';
  } else if (category === 'shift') {
    if (triggerType === 'shiftCreated') {
      return 'shift_created';
    }
    return 'shift_reminder';
  }
  
  // Default fallback
  return 'system_notification';
}

/**
 * Migrate a single legacy template to the new system
 */
export async function migrateLegacyTemplate(
  tenantId: string,
  legacyTemplateId: string
): Promise<string | null> {
  try {
    // Get legacy template
    const legacyDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsTemplates')
      .doc(legacyTemplateId)
      .get();
    
    if (!legacyDoc.exists) {
      logger.warn(`Legacy template ${legacyTemplateId} not found in tenant ${tenantId}`);
      return null;
    }
    
    const legacyTemplate = { id: legacyDoc.id, ...legacyDoc.data() } as LegacySmsTemplate;
    
    // Check if already migrated
    const messageTypeId = mapLegacyToMessageType(
      legacyTemplate.category,
      legacyTemplate.triggerType,
      legacyTemplate.triggerStatus
    );
    
    const existingQuery = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .where('messageTypeId', '==', messageTypeId)
      .where('channel', '==', 'sms')
      .where('language', '==', 'en')
      .limit(1)
      .get();
    
    if (!existingQuery.empty) {
      logger.info(`Template already exists for ${messageTypeId}, skipping migration`);
      return existingQuery.docs[0].id;
    }
    
    // Create new template
    // Note: MessageTemplate doesn't include tenantId in the interface, but we store it in Firestore
    const newTemplate = {
      messageTypeId,
      channel: 'sms' as const,
      language: 'en' as const,
      name: legacyTemplate.name,
      body: legacyTemplate.messageTemplate,
      variables: legacyTemplate.variables || [],
      includeStopFooter: true, // Default for SMS
      active: legacyTemplate.enabled,
      version: 1,
      createdBy: legacyTemplate.createdBy,
    };
    
    const newTemplateRef = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('messageTemplates')
      .add({
        ...newTemplate,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    
    logger.info(`Migrated template ${legacyTemplateId} -> ${newTemplateRef.id} (messageType: ${messageTypeId})`);
    
    // Mark legacy template as migrated (don't delete yet)
    await legacyDoc.ref.update({
      _migrated: true,
      _migratedTo: newTemplateRef.id,
      _migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    
    return newTemplateRef.id;
  } catch (error: any) {
    logger.error(`Error migrating template ${legacyTemplateId}:`, error);
    return null;
  }
}

/**
 * Migrate all legacy templates for a tenant
 */
export async function migrateAllLegacyTemplates(tenantId: string): Promise<{
  migrated: number;
  skipped: number;
  errors: number;
}> {
  try {
    const legacyTemplates = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsTemplates')
      .where('_migrated', '!=', true) // Only migrate unmigrated templates
      .get();
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const doc of legacyTemplates.docs) {
      const result = await migrateLegacyTemplate(tenantId, doc.id);
      if (result) {
        migrated++;
      } else if (result === null) {
        skipped++;
      } else {
        errors++;
      }
    }
    
    logger.info(`Migration complete for tenant ${tenantId}: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);
    
    return { migrated, skipped, errors };
  } catch (error: any) {
    logger.error(`Error migrating templates for tenant ${tenantId}:`, error);
    return { migrated: 0, skipped: 0, errors: 1 };
  }
}

/**
 * Get template from new system, with fallback to legacy system
 * 
 * This bridges the gap during migration - tries new system first, falls back to legacy
 */
export async function getTemplateWithLegacyFallback(
  tenantId: string,
  messageTypeId: string,
  channel: 'sms' | 'email' | 'push',
  language: 'en' | 'es' = 'en',
  legacyCategory?: LegacySmsTemplate['category'],
  legacyTriggerType?: string,
  legacyTriggerStatus?: string
): Promise<{ template: any; source: 'new' | 'legacy' } | null> {
  try {
    // Try new template system first
    const { getTemplate } = await import('./templateEngine');
    const newTemplate = await getTemplate(tenantId, messageTypeId, channel, language);
    
    if (newTemplate) {
      return { template: newTemplate, source: 'new' };
    }
    
    // Fallback to legacy system if category/trigger provided
    if (legacyCategory && legacyTriggerType) {
      logger.info(`Template not found in new system, checking legacy for ${legacyCategory}/${legacyTriggerType}`);
      
      let legacyQuery = db
        .collection('tenants')
        .doc(tenantId)
        .collection('smsTemplates')
        .where('category', '==', legacyCategory)
        .where('triggerType', '==', legacyTriggerType)
        .where('enabled', '==', true);
      
      if (legacyTriggerStatus) {
        legacyQuery = legacyQuery.where('triggerStatus', '==', legacyTriggerStatus) as any;
      }
      
      const legacySnapshot = await legacyQuery.limit(1).get();
      
      if (!legacySnapshot.empty) {
        const legacyTemplate = legacySnapshot.docs[0].data() as LegacySmsTemplate;
        logger.info(`Using legacy template ${legacySnapshot.docs[0].id} (consider migrating)`);
        
        // Convert legacy template to MessageTemplate-like structure
        return {
          template: {
            id: legacySnapshot.docs[0].id,
            tenantId,
            messageTypeId,
            channel,
            language,
            name: legacyTemplate.name,
            body: legacyTemplate.messageTemplate,
            variables: legacyTemplate.variables || [],
            includeStopFooter: true,
            active: legacyTemplate.enabled,
            version: 1,
          },
          source: 'legacy',
        };
      }
    }
    
    return null;
  } catch (error: any) {
    logger.error(`Error getting template with legacy fallback:`, error);
    return null;
  }
}

