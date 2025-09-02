import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Cache for kill switch settings
const killSwitchCache = new Map<string, { data: any; timestamp: number }>();
const KILL_SWITCH_CACHE_DURATION = 30 * 1000; // 30 seconds cache

export interface KillSwitchConfig {
  enabled: boolean;
  reason?: string;
  functions?: string[]; // Specific functions to disable, or all if empty
  samplingRate?: number; // 0-1, percentage of requests to allow through
  expiresAt?: admin.firestore.Timestamp;
  createdBy?: string;
  createdAt: admin.firestore.Timestamp;
}

/**
 * Check if a function is disabled by remote kill switch
 */
export async function isFunctionDisabled(functionName: string): Promise<boolean> {
  try {
    const config = await getKillSwitchConfig();
    
    if (!config.enabled) {
      return false; // Kill switch is off, allow all functions
    }
    
    // Check if function is specifically targeted
    if (config.functions && config.functions.length > 0) {
      if (!config.functions.includes(functionName)) {
        return false; // Function not in target list, allow it
      }
    }
    
    // Check if kill switch has expired
    if (config.expiresAt && config.expiresAt.toDate() < new Date()) {
      return false; // Kill switch expired, allow function
    }
    
    // Apply sampling rate if specified
    if (config.samplingRate !== undefined && config.samplingRate > 0) {
      const random = Math.random();
      if (random <= config.samplingRate) {
        return false; // Allow this request through sampling
      }
    }
    
    return true; // Function is disabled
  } catch (error) {
    console.error('Error checking kill switch:', error);
    return false; // On error, allow function to proceed
  }
}

/**
 * Get current kill switch configuration
 */
export async function getKillSwitchConfig(): Promise<KillSwitchConfig> {
  const cacheKey = 'kill_switch_config';
  
  // Check cache first
  const cached = killSwitchCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp) < KILL_SWITCH_CACHE_DURATION) {
    return cached.data;
  }
  
  try {
    const configDoc = await db.collection('system').doc('killSwitch').get();
    
    if (!configDoc.exists) {
      // Default config: kill switch disabled
      const defaultConfig: KillSwitchConfig = {
        enabled: false,
        createdAt: admin.firestore.Timestamp.now()
      };
      
      // Cache the default config
      killSwitchCache.set(cacheKey, { data: defaultConfig, timestamp: now });
      return defaultConfig;
    }
    
    const config = configDoc.data() as KillSwitchConfig;
    
    // Cache the config
    killSwitchCache.set(cacheKey, { data: config, timestamp: now });
    
    return config;
  } catch (error) {
    console.error('Error fetching kill switch config:', error);
    
    // Return default config on error
    const defaultConfig: KillSwitchConfig = {
      enabled: false,
      createdAt: admin.firestore.Timestamp.now()
    };
    
    return defaultConfig;
  }
}

/**
 * Update kill switch configuration
 */
export async function updateKillSwitchConfig(
  config: Partial<KillSwitchConfig>,
  userId?: string
): Promise<void> {
  try {
    const currentConfig = await getKillSwitchConfig();
    
    const updatedConfig: KillSwitchConfig = {
      ...currentConfig,
      ...config,
      createdAt: currentConfig.createdAt,
      createdBy: userId || currentConfig.createdBy
    };
    
    await db.collection('system').doc('killSwitch').set(updatedConfig);
    
    // Clear cache to force refresh
    killSwitchCache.clear();
    
    console.log('Kill switch config updated:', updatedConfig);
  } catch (error) {
    console.error('Error updating kill switch config:', error);
    throw error;
  }
}

/**
 * Enable kill switch for specific functions or all functions
 */
export async function enableKillSwitch(
  reason: string,
  functions?: string[],
  samplingRate?: number,
  expiresAt?: Date,
  userId?: string
): Promise<void> {
  const config: Partial<KillSwitchConfig> = {
    enabled: true,
    reason,
    functions,
    samplingRate,
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : undefined
  };
  
  await updateKillSwitchConfig(config, userId);
}

/**
 * Disable kill switch
 */
export async function disableKillSwitch(userId?: string): Promise<void> {
  await updateKillSwitchConfig({ enabled: false }, userId);
}

/**
 * Get kill switch status
 */
export async function getKillSwitchStatus(): Promise<{
  enabled: boolean;
  reason?: string;
  functions?: string[];
  samplingRate?: number;
  expiresAt?: admin.firestore.Timestamp;
  createdBy?: string;
  createdAt: admin.firestore.Timestamp;
}> {
  const config = await getKillSwitchConfig();
  return {
    enabled: config.enabled,
    reason: config.reason,
    functions: config.functions,
    samplingRate: config.samplingRate,
    expiresAt: config.expiresAt,
    createdBy: config.createdBy,
    createdAt: config.createdAt
  };
}

/**
 * Clear kill switch cache (useful for testing)
 */
export function clearKillSwitchCache(): void {
  killSwitchCache.clear();
}
