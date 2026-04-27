/**
 * Cloud Functions for Message Types Registry Management
 * 
 * Provides callable functions for admin UI to manage message types
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import {
  getAllMessageTypes,
  getMessageTypeConfig,
  updateMessageType,
  initializeMessageTypes,
  getMessageTypesByCategory,
  MessageTypeConfig,
  MessageCategory,
} from './messageTypesRegistry';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

/**
 * Get all message types for a tenant
 */
export const getMessageTypes = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId } = request.data as { tenantId: string };

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
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
    
    // Security levels 5, 6, 7 are Admin/Manager levels
    if (!securityLevel || securityLevel < 5) {
      throw new HttpsError('permission-denied', 'Only admins and managers (security level 5+) can view message types');
    }

    const messageTypes = await getAllMessageTypes(tenantId);
    return { success: true, messageTypes };
  } catch (error: any) {
    logger.error('Error getting message types:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get message types: ${error.message}`);
  }
});

/**
 * Get message type by ID
 */
export const getMessageType = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, messageTypeId } = request.data as {
    tenantId: string;
    messageTypeId: string;
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
      throw new HttpsError('permission-denied', 'Only admins and managers can view message types');
    }

    const messageType = await getMessageTypeConfig(tenantId, messageTypeId);
    
    if (!messageType) {
      throw new HttpsError('not-found', `Message type ${messageTypeId} not found`);
    }

    return { success: true, messageType };
  } catch (error: any) {
    logger.error('Error getting message type:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get message type: ${error.message}`);
  }
});

/**
 * Update message type configuration
 */
export const updateMessageTypeConfig = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, messageTypeId, updates } = request.data as {
    tenantId: string;
    messageTypeId: string;
    updates: Partial<MessageTypeConfig>;
  };

  if (!tenantId || !messageTypeId || !updates) {
    throw new HttpsError('invalid-argument', 'tenantId, messageTypeId, and updates are required');
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
      throw new HttpsError('permission-denied', 'Only admins and managers can update message types');
    }

    await updateMessageType(tenantId, messageTypeId, updates);
    return { success: true };
  } catch (error: any) {
    logger.error('Error updating message type:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to update message type: ${error.message}`);
  }
});

/**
 * Initialize message types for a tenant (seed defaults)
 */
export const initializeMessageTypesForTenant = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId } = request.data as { tenantId: string };

  if (!tenantId) {
    throw new HttpsError('invalid-argument', 'tenantId is required');
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
      throw new HttpsError('permission-denied', 'Only admins and managers can initialize message types');
    }

    await initializeMessageTypes(tenantId);
    return { success: true };
  } catch (error: any) {
    logger.error('Error initializing message types:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to initialize message types: ${error.message}`);
  }
});

/**
 * Get message types by category
 */
export const getMessageTypesByCategoryFn = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const { tenantId, category } = request.data as {
    tenantId: string;
    category: MessageCategory;
  };

  if (!tenantId || !category) {
    throw new HttpsError('invalid-argument', 'tenantId and category are required');
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
      throw new HttpsError('permission-denied', 'Only admins and managers can view message types');
    }

    const messageTypes = await getMessageTypesByCategory(tenantId, category);
    return { success: true, messageTypes };
  } catch (error: any) {
    logger.error('Error getting message types by category:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', `Failed to get message types: ${error.message}`);
  }
});

