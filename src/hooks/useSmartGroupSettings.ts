/**
 * Load/save Smart Groups tenant settings (custom metros).
 * Path: tenants/{tenantId}/settings/smartGroups
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface CustomSubarea {
  subareaKey: string;
  label: string;
  cityKeys: string[];
}

export interface CustomMetro {
  label: string;
  subareas: CustomSubarea[];
}

export type CustomMetrosMap = Record<string, CustomMetro>;

export interface SmartGroupSettingsDoc {
  customMetros?: CustomMetrosMap;
  updatedAt?: unknown;
}

export function useSmartGroupSettings(tenantId: string | undefined) {
  const [customMetros, setCustomMetros] = useState<CustomMetrosMap>({});
  const [loading, setLoading] = useState(!!tenantId);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tenantId) {
      setCustomMetros({});
      setLoading(false);
      return;
    }
    const ref = doc(db, 'tenants', tenantId, 'settings', 'smartGroups');
    getDoc(ref)
      .then((snap) => {
        const data = snap.data() as SmartGroupSettingsDoc | undefined;
        setCustomMetros(data?.customMetros ?? {});
      })
      .catch((e) => {
        setError(e instanceof Error ? e : new Error(String(e)));
        setCustomMetros({});
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  const saveCustomMetros = useCallback(
    async (metros: CustomMetrosMap) => {
      if (!tenantId) return;
      setError(null);
      const ref = doc(db, 'tenants', tenantId, 'settings', 'smartGroups');
      await setDoc(
        ref,
        { customMetros: metros, updatedAt: new Date() },
        { merge: true }
      );
      setCustomMetros(metros);
    },
    [tenantId]
  );

  const addCustomMetro = useCallback(
    async (metroKey: string, metro: CustomMetro) => {
      const next = { ...customMetros, [metroKey]: metro };
      await saveCustomMetros(next);
    },
    [customMetros, saveCustomMetros]
  );

  const removeCustomMetro = useCallback(
    async (metroKey: string) => {
      const { [metroKey]: _, ...rest } = customMetros;
      await saveCustomMetros(rest);
    },
    [customMetros, saveCustomMetros]
  );

  return {
    customMetros,
    loading,
    error,
    saveCustomMetros,
    addCustomMetro,
    removeCustomMetro,
  };
}
