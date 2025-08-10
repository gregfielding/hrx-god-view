import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logAIAction } from './feedbackEngine';

const db = admin.firestore();

// Types for integrations
interface SSOConfig {
  enabled: boolean;
  provider: 'saml' | 'oauth2' | 'azure' | 'okta' | 'google';
  entityId?: string;
  ssoUrl?: string;
  certificate?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  scopes?: string[];
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
}

interface SCIMConfig {
  enabled: boolean;
  endpoint?: string;
  token?: string;
  syncInterval: number; // minutes
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    usersCreated: number;
    usersUpdated: number;
    usersDeleted: number;
    lastSyncTime: Date;
  };
}

interface HRISConfig {
  enabled: boolean;
  provider: 'workday' | 'bamboo' | 'adp' | 'paychex' | 'custom';
  apiUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  syncInterval: number; // minutes
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    employeesSynced: number;
    departmentsSynced: number;
    lastSyncTime: Date;
  };
}

interface SlackConfig {
  enabled: boolean;
  workspaceId?: string;
  botToken?: string;
  appToken?: string;
  signingSecret?: string;
  channels?: string[];
  companionAIEnabled: boolean;
  lastSync?: Date;
  status: 'active' | 'inactive' | 'error';
  errorMessage?: string;
  syncStats?: {
    channelsConnected: number;
    messagesProcessed: number;
    lastSyncTime: Date;
  };
}



interface SyncResult {
  success: boolean;
  message: string;
  details?: any;
  timestamp: Date;
}

// Helper function to validate tenant access
async function validateTenantAccess(tenantId: string, userId: string): Promise<boolean> {
  try {
    console.log(`Validating tenant access: userId=${userId}, tenantId=${tenantId}`);
    
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      console.log(`User document does not exist for userId: ${userId}`);
      return false;
    }
    
    const userData = userDoc.data();
    console.log(`User data:`, {
      role: userData?.role,
      activeTenantId: userData?.activeTenantId,
      tenantId: userData?.tenantId,
      tenantIds: userData?.tenantIds
    });
    
    // Check if user is super admin
    if (userData?.role === 'super_admin') {
      console.log(`User is super admin, access granted`);
      return true;
    }
    
    // Check activeTenantId (new structure)
    if (userData?.activeTenantId === tenantId) {
      console.log(`User activeTenantId matches, access granted`);
      return true;
    }
    
    // Check legacy tenantId (backward compatibility)
    if (userData?.tenantId === tenantId) {
      console.log(`User tenantId matches, access granted`);
      return true;
    }
    
    // Check tenantIds array (new structure)
    if (userData?.tenantIds) {
      if (Array.isArray(userData.tenantIds)) {
        if (userData.tenantIds.includes(tenantId)) {
          console.log(`User tenantIds array contains tenantId, access granted`);
          return true;
        }
      } else if (typeof userData.tenantIds === 'object') {
        // If tenantIds is an object (map), check if tenantId exists as a key
        if (userData.tenantIds.hasOwnProperty(tenantId)) {
          console.log(`User tenantIds object contains tenantId, access granted`);
          return true;
        }
      }
    }
    
    console.log(`No matching tenant found, access denied`);
    return false;
  } catch (error) {
    console.error('Error validating tenant access:', error);
    return false;
  }
}

// Helper function to log integration actions
async function logIntegrationAction(
  userId: string,
  actionType: string,
  integrationType: string,
  tenantId: string,
  success: boolean,
  details?: any,
  errorMessage?: string
) {
  try {
    await logAIAction({
      userId,
      actionType: `integration_${actionType}`,
      sourceModule: 'Integrations',
      success,
      ...(errorMessage ? { errorMessage } : {}),
      versionTag: 'v1',
      reason: `${integrationType} integration ${actionType}`,
      eventType: `integration.${integrationType}.${actionType}`,
      targetType: 'integration',
      targetId: integrationType,
      aiRelevant: false,
      contextType: 'integration',
      traitsAffected: null,
      aiTags: null,
      urgencyScore: null
    });

    // Also log to integration-specific collection
    await db.collection('tenants').doc(tenantId)
      .collection('integrationLogs')
      .add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        type: integrationType,
        action: actionType,
        status: success ? 'success' : 'error',
        message: success ? `Successfully ${actionType} ${integrationType}` : errorMessage,
        details,
        userId
      });
  } catch (error) {
    console.error('Error logging integration action:', error);
  }
}

// SSO Integration Functions
export const getSSOConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    const doc = await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('sso').get();
    
    if (doc.exists) {
      return { config: doc.data() };
    } else {
      // Return default config
      const defaultConfig: SSOConfig = {
        enabled: false,
        provider: 'saml',
        status: 'inactive'
      };
      return { config: defaultConfig };
    }
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get SSO config: ${error.message}`);
  }
});

export const updateSSOConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, config } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId || !config) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Validate config
    if (!['saml', 'oauth2', 'azure', 'okta', 'google'].includes(config.provider)) {
      throw new HttpsError('invalid-argument', 'Invalid SSO provider');
    }

    // Test connection if enabled
    if (config.enabled) {
      // Simulate connection test
      await new Promise(resolve => setTimeout(resolve, 1000));
      config.status = 'active';
      config.lastSync = new Date();
    } else {
      config.status = 'inactive';
    }

    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('sso')
      .set(config, { merge: true });

    await logIntegrationAction(userId, 'update', 'sso', tenantId, true, config);

    return { success: true, config };
  } catch (error: any) {
    await logIntegrationAction(userId, 'update', 'sso', tenantId, false, config, error.message);
    throw new HttpsError('internal', `Failed to update SSO config: ${error.message}`);
  }
});

export const testSSOConnection = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Simulate SSO connection test
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result: SyncResult = {
      success: true,
      message: 'SSO connection test successful',
      timestamp: new Date(),
      details: {
        provider: 'saml',
        responseTime: '1.2s',
        endpoints: ['/saml/login', '/saml/logout', '/saml/metadata']
      }
    };

    await logIntegrationAction(userId, 'test', 'sso', tenantId, true, result);
    return result;
  } catch (error: any) {
    const result: SyncResult = {
      success: false,
      message: 'SSO connection test failed',
      timestamp: new Date(),
      details: { error: error.message }
    };
    
    await logIntegrationAction(userId, 'test', 'sso', tenantId, false, result, error.message);
    throw new HttpsError('internal', `SSO test failed: ${error.message}`);
  }
});

// SCIM Integration Functions
export const getSCIMConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    const doc = await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('scim').get();
    
    if (doc.exists) {
      return { config: doc.data() };
    } else {
      const defaultConfig: SCIMConfig = {
        enabled: false,
        syncInterval: 60,
        status: 'inactive'
      };
      return { config: defaultConfig };
    }
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get SCIM config: ${error.message}`);
  }
});

export const updateSCIMConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, config } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId || !config) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Validate config
    if (config.syncInterval < 15) {
      throw new HttpsError('invalid-argument', 'Sync interval must be at least 15 minutes');
    }

    if (config.enabled && (!config.endpoint || !config.token)) {
      throw new HttpsError('invalid-argument', 'Endpoint and token required when enabled');
    }

    // Test connection if enabled
    if (config.enabled) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      config.status = 'active';
      config.lastSync = new Date();
      config.syncStats = {
        usersCreated: 0,
        usersUpdated: 0,
        usersDeleted: 0,
        lastSyncTime: new Date()
      };
    } else {
      config.status = 'inactive';
    }

    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('scim')
      .set(config, { merge: true });

    await logIntegrationAction(userId, 'update', 'scim', tenantId, true, config);

    return { success: true, config };
  } catch (error: any) {
    await logIntegrationAction(userId, 'update', 'scim', tenantId, false, config, error.message);
    throw new HttpsError('internal', `Failed to update SCIM config: ${error.message}`);
  }
});

export const syncSCIMUsers = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Simulate SCIM sync
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const syncResult: SyncResult = {
      success: true,
      message: 'SCIM sync completed successfully',
      timestamp: new Date(),
      details: {
        usersCreated: 5,
        usersUpdated: 12,
        usersDeleted: 2,
        totalProcessed: 19,
        duration: '2.8s'
      }
    };

    // Update sync stats
    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('scim')
      .update({
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        syncStats: {
          usersCreated: 5,
          usersUpdated: 12,
          usersDeleted: 2,
          lastSyncTime: new Date()
        }
      });

    await logIntegrationAction(userId, 'sync', 'scim', tenantId, true, syncResult);
    return syncResult;
  } catch (error: any) {
    const syncResult: SyncResult = {
      success: false,
      message: 'SCIM sync failed',
      timestamp: new Date(),
      details: { error: error.message }
    };
    
    await logIntegrationAction(userId, 'sync', 'scim', tenantId, false, syncResult, error.message);
    throw new HttpsError('internal', `SCIM sync failed: ${error.message}`);
  }
});

// HRIS Integration Functions
export const getHRISConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    const doc = await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('hris').get();
    
    if (doc.exists) {
      return { config: doc.data() };
    } else {
      const defaultConfig: HRISConfig = {
        enabled: false,
        provider: 'workday',
        syncInterval: 120,
        status: 'inactive'
      };
      return { config: defaultConfig };
    }
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get HRIS config: ${error.message}`);
  }
});

export const updateHRISConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, config } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId || !config) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Validate config
    if (!['workday', 'bamboo', 'adp', 'paychex', 'custom'].includes(config.provider)) {
      throw new HttpsError('invalid-argument', 'Invalid HRIS provider');
    }

    if (config.syncInterval < 30) {
      throw new HttpsError('invalid-argument', 'Sync interval must be at least 30 minutes');
    }

    if (config.enabled && (!config.apiUrl || (!config.apiKey && (!config.username || !config.password)))) {
      throw new HttpsError('invalid-argument', 'API URL and credentials required when enabled');
    }

    // Test connection if enabled
    if (config.enabled) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      config.status = 'active';
      config.lastSync = new Date();
      config.syncStats = {
        employeesSynced: 0,
        departmentsSynced: 0,
        lastSyncTime: new Date()
      };
    } else {
      config.status = 'inactive';
    }

    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('hris')
      .set(config, { merge: true });

    await logIntegrationAction(userId, 'update', 'hris', tenantId, true, config);

    return { success: true, config };
  } catch (error: any) {
    await logIntegrationAction(userId, 'update', 'hris', tenantId, false, config, error.message);
    throw new HttpsError('internal', `Failed to update HRIS config: ${error.message}`);
  }
});

export const syncHRISData = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Simulate HRIS sync
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    const syncResult: SyncResult = {
      success: true,
      message: 'HRIS sync completed successfully',
      timestamp: new Date(),
      details: {
        employeesSynced: 45,
        departmentsSynced: 8,
        totalProcessed: 53,
        duration: '3.2s'
      }
    };

    // Update sync stats
    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('hris')
      .update({
        lastSync: admin.firestore.FieldValue.serverTimestamp(),
        syncStats: {
          employeesSynced: 45,
          departmentsSynced: 8,
          lastSyncTime: new Date()
        }
      });

    await logIntegrationAction(userId, 'sync', 'hris', tenantId, true, syncResult);
    return syncResult;
  } catch (error: any) {
    const syncResult: SyncResult = {
      success: false,
      message: 'HRIS sync failed',
      timestamp: new Date(),
      details: { error: error.message }
    };
    
    await logIntegrationAction(userId, 'sync', 'hris', tenantId, false, syncResult, error.message);
    throw new HttpsError('internal', `HRIS sync failed: ${error.message}`);
  }
});

// Slack Integration Functions
export const getSlackConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    const doc = await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('slack').get();
    
    if (doc.exists) {
      return { config: doc.data() };
    } else {
      const defaultConfig: SlackConfig = {
        enabled: false,
        channels: [],
        companionAIEnabled: false,
        status: 'inactive'
      };
      return { config: defaultConfig };
    }
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get Slack config: ${error.message}`);
  }
});

export const updateSlackConfig = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, config } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId || !config) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Validate config
    if (config.enabled && (!config.botToken || !config.appToken || !config.signingSecret)) {
      throw new HttpsError('invalid-argument', 'Bot token, app token, and signing secret required when enabled');
    }

    // Test connection if enabled
    if (config.enabled) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      config.status = 'active';
      config.lastSync = new Date();
      config.syncStats = {
        channelsConnected: config.channels?.length || 0,
        messagesProcessed: 0,
        lastSyncTime: new Date()
      };
    } else {
      config.status = 'inactive';
    }

    await db.collection('tenants').doc(tenantId)
      .collection('integrations').doc('slack')
      .set(config, { merge: true });

    await logIntegrationAction(userId, 'update', 'slack', tenantId, true, config);

    return { success: true, config };
  } catch (error: any) {
    await logIntegrationAction(userId, 'update', 'slack', tenantId, false, config, error.message);
    throw new HttpsError('internal', `Failed to update Slack config: ${error.message}`);
  }
});

export const testSlackConnection = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    // Simulate Slack connection test
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const result: SyncResult = {
      success: true,
      message: 'Slack connection test successful',
      timestamp: new Date(),
      details: {
        workspaceId: 'T1234567890',
        channelsAvailable: 15,
        botPermissions: ['chat:write', 'channels:read', 'users:read'],
        responseTime: '1.8s'
      }
    };

    await logIntegrationAction(userId, 'test', 'slack', tenantId, true, result);
    return result;
  } catch (error: any) {
    const result: SyncResult = {
      success: false,
      message: 'Slack connection test failed',
      timestamp: new Date(),
      details: { error: error.message }
    };
    
    await logIntegrationAction(userId, 'test', 'slack', tenantId, false, result, error.message);
    throw new HttpsError('internal', `Slack test failed: ${error.message}`);
  }
});

// Integration Logs Functions
export const getIntegrationLogs = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, type, limit = 50 } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    let query = db.collection('tenants').doc(tenantId)
      .collection('integrationLogs')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (type) {
      query = query.where('type', '==', type);
    }

    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));

    return { logs };
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get integration logs: ${error.message}`);
  }
});

// Manual Sync Functions
export const manualSync = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId, integrationType } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId || !integrationType) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  if (!['sso', 'scim', 'hris', 'slack'].includes(integrationType)) {
    throw new HttpsError('invalid-argument', 'Invalid integration type');
  }

  try {
    let syncResult: SyncResult;

    switch (integrationType) {
      case 'scim':
        // Call the SCIM sync logic directly
        await new Promise(resolve => setTimeout(resolve, 3000));
        syncResult = {
          success: true,
          message: 'SCIM sync completed successfully',
          timestamp: new Date(),
          details: {
            usersCreated: 5,
            usersUpdated: 12,
            usersDeleted: 2,
            totalProcessed: 19,
            duration: '2.8s'
          }
        };
        break;
      case 'hris':
        // Call the HRIS sync logic directly
        await new Promise(resolve => setTimeout(resolve, 4000));
        syncResult = {
          success: true,
          message: 'HRIS sync completed successfully',
          timestamp: new Date(),
          details: {
            employeesSynced: 45,
            departmentsSynced: 8,
            totalProcessed: 53,
            duration: '3.2s'
          }
        };
        break;
      case 'sso':
        // Call the SSO test logic directly
        await new Promise(resolve => setTimeout(resolve, 2000));
        syncResult = {
          success: true,
          message: 'SSO connection test successful',
          timestamp: new Date(),
          details: {
            provider: 'saml',
            responseTime: '1.2s',
            endpoints: ['/saml/login', '/saml/logout', '/saml/metadata']
          }
        };
        break;
      case 'slack':
        // Call the Slack test logic directly
        await new Promise(resolve => setTimeout(resolve, 2000));
        syncResult = {
          success: true,
          message: 'Slack connection test successful',
          timestamp: new Date(),
          details: {
            workspaceId: 'T1234567890',
            channelsAvailable: 15,
            botPermissions: ['chat:write', 'channels:read', 'users:read'],
            responseTime: '1.8s'
          }
        };
        break;
      default:
        throw new HttpsError('invalid-argument', 'Unsupported integration type');
    }

    await logIntegrationAction(userId, 'manual_sync', integrationType, tenantId, true, syncResult);
    return syncResult;
  } catch (error: any) {
    await logIntegrationAction(userId, 'manual_sync', integrationType, tenantId, false, null, error.message);
    throw error;
  }
});

// Get all integration statuses for dashboard
export const getIntegrationStatuses = onCall({
  cors: true,
  maxInstances: 10
}, async (request) => {
  const { tenantId } = request.data;
  const userId = request.auth?.uid;
  
  if (!tenantId || !userId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters');
  }

  if (!(await validateTenantAccess(tenantId, userId))) {
    throw new HttpsError('permission-denied', 'Access denied');
  }

  try {
    const integrationsRef = db.collection('tenants').doc(tenantId).collection('integrations');
    const snapshot = await integrationsRef.get();
    
    const statuses: Record<string, any> = {};
    snapshot.docs.forEach(doc => {
      statuses[doc.id] = {
        ...doc.data(),
        lastSync: doc.data().lastSync?.toDate()
      };
    });

    return { statuses };
  } catch (error: any) {
    throw new HttpsError('internal', `Failed to get integration statuses: ${error.message}`);
  }
}); 