import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { 
  enableKillSwitch, 
  disableKillSwitch, 
  getKillSwitchStatus, 
  updateKillSwitchConfig,
  KillSwitchConfig 
} from './remoteKillSwitch';

/**
 * Enable kill switch for specific functions or all functions
 */
export const enableKillSwitchCallable = onCall({
  maxInstances: 2,
  timeoutSeconds: 30
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const { reason, functions, samplingRate, expiresAt } = request.data;

    // Validate required parameters
    if (!reason) {
      throw new HttpsError('invalid-argument', 'Reason is required');
    }

    // Validate optional parameters
    if (samplingRate !== undefined && (samplingRate < 0 || samplingRate > 1)) {
      throw new HttpsError('invalid-argument', 'Sampling rate must be between 0 and 1');
    }

    if (functions && !Array.isArray(functions)) {
      throw new HttpsError('invalid-argument', 'Functions must be an array');
    }

    let expiresAtDate: Date | undefined;
    if (expiresAt) {
      expiresAtDate = new Date(expiresAt);
      if (isNaN(expiresAtDate.getTime())) {
        throw new HttpsError('invalid-argument', 'Invalid expiration date');
      }
    }

    await enableKillSwitch(reason, functions, samplingRate, expiresAtDate, request.auth.uid);

    return {
      success: true,
      message: 'Kill switch enabled successfully',
      reason,
      functions,
      samplingRate,
      expiresAt: expiresAtDate
    };
  } catch (error) {
    console.error('Error enabling kill switch:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to enable kill switch');
  }
});

/**
 * Disable kill switch
 */
export const disableKillSwitchCallable = onCall({
  maxInstances: 2,
  timeoutSeconds: 30
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    await disableKillSwitch(request.auth.uid);

    return {
      success: true,
      message: 'Kill switch disabled successfully'
    };
  } catch (error) {
    console.error('Error disabling kill switch:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to disable kill switch');
  }
});

/**
 * Get current kill switch status
 */
export const getKillSwitchStatusCallable = onCall({
  maxInstances: 5,
  timeoutSeconds: 30
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const status = await getKillSwitchStatus();

    return {
      success: true,
      status
    };
  } catch (error) {
    console.error('Error getting kill switch status:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to get kill switch status');
  }
});

/**
 * Update kill switch configuration
 */
export const updateKillSwitchConfigCallable = onCall({
  maxInstances: 2,
  timeoutSeconds: 30
}, async (request) => {
  // Precondition guards
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    const config: Partial<KillSwitchConfig> = request.data;

    // Validate configuration
    if (config.samplingRate !== undefined && (config.samplingRate < 0 || config.samplingRate > 1)) {
      throw new HttpsError('invalid-argument', 'Sampling rate must be between 0 and 1');
    }

    if (config.functions && !Array.isArray(config.functions)) {
      throw new HttpsError('invalid-argument', 'Functions must be an array');
    }

    if (config.expiresAt) {
      let expiresAtDate: Date;
      if (typeof config.expiresAt === 'string' || typeof config.expiresAt === 'number') {
        expiresAtDate = new Date(config.expiresAt);
      } else if (config.expiresAt && typeof config.expiresAt === 'object' && 'toDate' in config.expiresAt) {
        // Handle Firestore Timestamp
        expiresAtDate = (config.expiresAt as any).toDate();
      } else {
        throw new HttpsError('invalid-argument', 'Invalid expiration date format');
      }
      
      if (isNaN(expiresAtDate.getTime())) {
        throw new HttpsError('invalid-argument', 'Invalid expiration date');
      }
    }

    await updateKillSwitchConfig(config, request.auth.uid);

    return {
      success: true,
      message: 'Kill switch configuration updated successfully',
      config
    };
  } catch (error) {
    console.error('Error updating kill switch config:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', 'Failed to update kill switch configuration');
  }
});
