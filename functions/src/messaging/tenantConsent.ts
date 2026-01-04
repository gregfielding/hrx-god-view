/**
 * Tenant-Scoped Consent Management
 * 
 * Manages SMS consent in tenant-scoped collections.
 * 
 * Implements: HRX One Messaging Phase 4 Spec — Section 3 Tenant-Scoped Consent & Notification Settings
 */

import * as admin from 'firebase-admin';
import { logger } from 'firebase-functions/v2';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * SMS Consent document structure
 * /tenants/{tenantId}/smsConsents/{userId}
 */
export interface SmsConsent {
  userId: string;
  tenantId: string;
  phoneNumber: string;
  smsOptIn: boolean;
  smsBlockedSystem: boolean; // Set true on STOP
  consentVersion?: string;    // e.g. "2025-01-27"
  lastUpdatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  source: 'signup' | 'keyword' | 'admin' | 'import' | 'system';
}

/**
 * Consent event document structure
 * /tenants/{tenantId}/smsConsents/{userId}/events/{eventId}
 */
export interface ConsentEvent {
  eventId: string;
  tenantId: string;
  userId: string;
  type: 'OPT_IN' | 'OPT_OUT' | 'STOP' | 'START' | 'HELP' | 'ADMIN_UPDATE';
  previousValue?: any;
  newValue?: any;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  source: 'signup' | 'keyword' | 'admin' | 'system';
  rawMessageSid?: string;
  rawPayload?: any;
}

/**
 * Get tenant-scoped SMS consent for a user
 * Falls back to user document fields for backward compatibility
 */
export async function getTenantSmsConsent(
  tenantId: string,
  userId: string
): Promise<SmsConsent | null> {
  try {
    const consentDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsConsents')
      .doc(userId)
      .get();
    
    if (consentDoc.exists) {
      return consentDoc.data() as SmsConsent;
    }
    
    return null;
  } catch (error: any) {
    logger.error(`Error getting tenant SMS consent for ${userId} in tenant ${tenantId}:`, error);
    return null;
  }
}

/**
 * Update tenant-scoped SMS consent
 * Also mirrors critical fields to /users/{userId} for backward compatibility
 */
export async function updateTenantSmsConsent(
  tenantId: string,
  userId: string,
  updates: Partial<SmsConsent>,
  event?: {
    type: ConsentEvent['type'];
    source: ConsentEvent['source'];
    previousValue?: any;
    newValue?: any;
    rawMessageSid?: string;
    rawPayload?: any;
  }
): Promise<void> {
  try {
    const consentRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('smsConsents')
      .doc(userId);
    
    const consentDoc = await consentRef.get();
    const existingConsent = consentDoc.exists ? consentDoc.data() as SmsConsent : null;
    
    // Update consent document
    const updateData: Partial<SmsConsent> = {
      ...updates,
      userId,
      tenantId,
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    
    if (!consentDoc.exists) {
      // Create new consent document
      await consentRef.set({
        userId,
        tenantId,
        phoneNumber: updates.phoneNumber || '',
        smsOptIn: updates.smsOptIn ?? false,
        smsBlockedSystem: updates.smsBlockedSystem ?? false,
        source: updates.source || 'system',
        ...updateData,
      });
    } else {
      await consentRef.update(updateData);
    }
    
    // Mirror critical fields to /users/{userId} for backward compatibility
    const userRef = db.collection('users').doc(userId);
    const mirrorUpdates: any = {};
    
    if (updates.smsOptIn !== undefined) {
      mirrorUpdates.smsOptIn = updates.smsOptIn;
    }
    if (updates.smsBlockedSystem !== undefined) {
      mirrorUpdates.smsBlockedSystem = updates.smsBlockedSystem;
    }
    if (updates.phoneNumber) {
      mirrorUpdates.phoneE164 = updates.phoneNumber;
    }
    
    if (Object.keys(mirrorUpdates).length > 0) {
      await userRef.update(mirrorUpdates);
      logger.info(`Mirrored SMS consent fields to /users/${userId} for backward compatibility`);
    }
    
    // Log consent event if provided
    if (event) {
      const eventRef = consentRef.collection('events').doc();
      await eventRef.set({
        eventId: eventRef.id,
        tenantId,
        userId,
        type: event.type,
        previousValue: event.previousValue ?? existingConsent,
        newValue: event.newValue ?? updateData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: event.source,
        rawMessageSid: event.rawMessageSid,
        rawPayload: event.rawPayload,
      });
      
      logger.info(`Logged consent event ${event.type} for user ${userId} in tenant ${tenantId}`);
    }
  } catch (error: any) {
    logger.error(`Error updating tenant SMS consent for ${userId} in tenant ${tenantId}:`, error);
    throw error;
  }
}

