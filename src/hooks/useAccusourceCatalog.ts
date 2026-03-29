import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { AccusourceCatalogDocument } from '../types/accusourceCatalog';

export type AccusourceCatalogRefetchResult = { ok: true } | { ok: false; error: string };

/** Loads `integrations_accusource/catalog` once per mount (shared pattern with Backgrounds compliance). */
export function useAccusourceCatalog(): {
  catalog: AccusourceCatalogDocument | null;
  loading: boolean;
  refetch: () => Promise<AccusourceCatalogRefetchResult>;
} {
  const [catalog, setCatalog] = useState<AccusourceCatalogDocument | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async (): Promise<AccusourceCatalogRefetchResult> => {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, p.integrationsAccusource(), p.integrationsAccusourceCatalogDocId()));
      setCatalog(snap.exists() ? (snap.data() as AccusourceCatalogDocument) : null);
      return { ok: true };
    } catch (e) {
      console.warn('[useAccusourceCatalog] Firestore read integrations_accusource/catalog failed', e);
      setCatalog(null);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { catalog, loading, refetch };
}
