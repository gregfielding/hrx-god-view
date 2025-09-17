import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';

/**
 * Hook for accessing feature flags from tenant settings
 * @param flagName - The name of the feature flag to check
 * @param defaultValue - Default value if flag is not set (defaults to false)
 * @returns Object with flag value, loading state, and error state
 */
export const useFlag = (flagName: string, defaultValue = false) => {
  const { tenantId } = useAuth();
  const [flagValue, setFlagValue] = useState<boolean>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setFlagValue(defaultValue);
      setLoading(false);
      return;
    }

    const configRef = doc(db, 'tenants', tenantId, 'settings', 'config');
    
    const unsubscribe = onSnapshot(
      configRef,
      (doc) => {
        try {
          if (doc.exists()) {
            const data = doc.data();
            const flags = data?.flags || {};
            setFlagValue(flags[flagName] ?? defaultValue);
          } else {
            // Document doesn't exist, use default value
            setFlagValue(defaultValue);
          }
          setError(null);
        } catch (err) {
          console.error(`Error reading flag ${flagName}:`, err);
          setError(err instanceof Error ? err.message : 'Unknown error');
          setFlagValue(defaultValue);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error(`Error listening to flag ${flagName}:`, err);
        setError(err.message);
        setFlagValue(defaultValue);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, flagName, defaultValue]);

  return {
    value: flagValue,
    loading,
    error,
  };
};

/**
 * Hook for accessing multiple feature flags at once
 * @param flagNames - Array of flag names to check
 * @param defaultValues - Object with default values for each flag
 * @returns Object with flag values, loading state, and error state
 */
export const useFlags = (flagNames: string[], defaultValues: Record<string, boolean> = {}) => {
  const { tenantId } = useAuth();
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) {
      const defaultFlags: Record<string, boolean> = {};
      flagNames.forEach(name => {
        defaultFlags[name] = defaultValues[name] ?? false;
      });
      setFlags(defaultFlags);
      setLoading(false);
      return;
    }

    const configRef = doc(db, 'tenants', tenantId, 'settings', 'config');
    
    const unsubscribe = onSnapshot(
      configRef,
      (doc) => {
        try {
          const newFlags: Record<string, boolean> = {};
          
          if (doc.exists()) {
            const data = doc.data();
            const configFlags = data?.flags || {};
            
            flagNames.forEach(name => {
              newFlags[name] = configFlags[name] ?? defaultValues[name] ?? false;
            });
          } else {
            // Document doesn't exist, use default values
            flagNames.forEach(name => {
              newFlags[name] = defaultValues[name] ?? false;
            });
          }
          
          setFlags(newFlags);
          setError(null);
        } catch (err) {
          console.error('Error reading flags:', err);
          setError(err instanceof Error ? err.message : 'Unknown error');
          
          // Set default values on error
          const defaultFlags: Record<string, boolean> = {};
          flagNames.forEach(name => {
            defaultFlags[name] = defaultValues[name] ?? false;
          });
          setFlags(defaultFlags);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        console.error('Error listening to flags:', err);
        setError(err.message);
        
        // Set default values on error
        const defaultFlags: Record<string, boolean> = {};
        flagNames.forEach(name => {
          defaultFlags[name] = defaultValues[name] ?? false;
        });
        setFlags(defaultFlags);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tenantId, flagNames.join(','), JSON.stringify(defaultValues)]);

  return {
    flags,
    loading,
    error,
  };
};
