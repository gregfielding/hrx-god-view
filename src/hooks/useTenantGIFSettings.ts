/**
 * useTenantGIFSettings Hook
 * 
 * Checks if GIFs are allowed for the current tenant.
 * Reads from tenants/{tenantId}/settings/messaging.allowGIFs
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface UseTenantGIFSettingsReturn {
  allowGIFs: boolean;
  loading: boolean;
  error: Error | null;
}

/**
 * Hook to check if GIFs are allowed for a tenant
 */
export function useTenantGIFSettings(tenantId: string | null): UseTenantGIFSettingsReturn {
  const [allowGIFs, setAllowGIFs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setAllowGIFs(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const settingsRef = doc(db, 'tenants', tenantId, 'settings', 'messaging');

    getDoc(settingsRef)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setAllowGIFs(data.allowGIFs === true);
        } else {
          // Default to false if settings don't exist
          setAllowGIFs(false);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading GIF settings:', err);
        setError(err);
        setAllowGIFs(false);
        setLoading(false);
      });
  }, [tenantId]);

  return {
    allowGIFs,
    loading,
    error,
  };
}

