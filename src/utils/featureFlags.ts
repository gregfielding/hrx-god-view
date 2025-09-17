import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';

/**
 * Get all feature flags for a tenant
 * @param tenantId - The tenant ID
 * @returns Promise with all flags or empty object if none exist
 */
export const getFeatureFlags = async (tenantId: string): Promise<Record<string, boolean>> => {
  try {
    const configRef = doc(db, p.config(tenantId));
    const configDoc = await getDoc(configRef);
    
    if (configDoc.exists()) {
      const data = configDoc.data();
      return data?.flags || {};
    }
    
    return {};
  } catch (error) {
    console.error('Error getting feature flags:', error);
    return {};
  }
};

/**
 * Get a specific feature flag value
 * @param tenantId - The tenant ID
 * @param flagName - The name of the flag
 * @param defaultValue - Default value if flag doesn't exist
 * @returns Promise with flag value
 */
export const getFeatureFlag = async (
  tenantId: string, 
  flagName: string, 
  defaultValue?: boolean
): Promise<boolean> => {
  try {
    const flags = await getFeatureFlags(tenantId);
    const value = flags[flagName];
    
    // If no value exists, use environment-based defaults
    if (value === undefined) {
      return getDefaultFeatureFlag(flagName, defaultValue);
    }
    
    return value;
  } catch (error) {
    console.error(`Error getting feature flag ${flagName}:`, error);
    return getDefaultFeatureFlag(flagName, defaultValue);
  }
};

/**
 * Get default feature flag value based on environment
 */
const getDefaultFeatureFlag = (flagName: string, fallback?: boolean): boolean => {
  // Environment-based defaults for Phase 1.5
  const environmentDefaults: Record<string, boolean> = {
    NEW_DATA_MODEL: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
    // Add other flags as needed
  };
  
  return environmentDefaults[flagName] ?? fallback ?? false;
};

/**
 * Set a feature flag value
 * @param tenantId - The tenant ID
 * @param flagName - The name of the flag
 * @param value - The value to set
 * @returns Promise that resolves when flag is set
 */
export const setFeatureFlag = async (
  tenantId: string, 
  flagName: string, 
  value: boolean
): Promise<void> => {
  try {
    const configRef = doc(db, p.config(tenantId));
    
    // Get existing config to preserve other settings
    const configDoc = await getDoc(configRef);
    const existingData = configDoc.exists() ? configDoc.data() : {};
    
    // Update flags object
    const updatedFlags = {
      ...existingData.flags,
      [flagName]: value
    };
    
    // Update the document
    await setDoc(configRef, {
      ...existingData,
      flags: updatedFlags,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    console.log(`Feature flag ${flagName} set to ${value} for tenant ${tenantId}`);
  } catch (error) {
    console.error(`Error setting feature flag ${flagName}:`, error);
    throw error;
  }
};

/**
 * Set multiple feature flags at once
 * @param tenantId - The tenant ID
 * @param flags - Object with flag names and values
 * @returns Promise that resolves when all flags are set
 */
export const setFeatureFlags = async (
  tenantId: string, 
  flags: Record<string, boolean>
): Promise<void> => {
  try {
    const configRef = doc(db, p.config(tenantId));
    
    // Get existing config to preserve other settings
    const configDoc = await getDoc(configRef);
    const existingData = configDoc.exists() ? configDoc.data() : {};
    
    // Update flags object
    const updatedFlags = {
      ...existingData.flags,
      ...flags
    };
    
    // Update the document
    await setDoc(configRef, {
      ...existingData,
      flags: updatedFlags,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    console.log(`Feature flags updated for tenant ${tenantId}:`, flags);
  } catch (error) {
    console.error('Error setting feature flags:', error);
    throw error;
  }
};

/**
 * Initialize the config document with default flags if it doesn't exist
 * @param tenantId - The tenant ID
 * @param defaultFlags - Default flags to set
 * @returns Promise that resolves when config is initialized
 */
export const initializeFeatureFlags = async (
  tenantId: string, 
  defaultFlags: Record<string, boolean> = {}
): Promise<void> => {
  try {
    const configRef = doc(db, p.config(tenantId));
    const configDoc = await getDoc(configRef);
    
    if (!configDoc.exists()) {
      // Use environment-based defaults if none provided
      const flags = Object.keys(defaultFlags).length > 0 ? defaultFlags : {
        NEW_DATA_MODEL: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
      };
      
      await setDoc(configRef, {
        flags,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      
      console.log(`Initialized feature flags for tenant ${tenantId}:`, flags);
    }
  } catch (error) {
    console.error('Error initializing feature flags:', error);
    throw error;
  }
};

/**
 * Remove a feature flag
 * @param tenantId - The tenant ID
 * @param flagName - The name of the flag to remove
 * @returns Promise that resolves when flag is removed
 */
export const removeFeatureFlag = async (tenantId: string, flagName: string): Promise<void> => {
  try {
    const configRef = doc(db, p.config(tenantId));
    const configDoc = await getDoc(configRef);
    
    if (configDoc.exists()) {
      const data = configDoc.data();
      const flags = { ...data.flags };
      delete flags[flagName];
      
      await updateDoc(configRef, {
        flags,
        updatedAt: new Date().toISOString()
      });
      
      console.log(`Feature flag ${flagName} removed for tenant ${tenantId}`);
    }
  } catch (error) {
    console.error(`Error removing feature flag ${flagName}:`, error);
    throw error;
  }
};
