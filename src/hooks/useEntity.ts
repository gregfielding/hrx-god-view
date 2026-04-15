/**
 * Load a single Entity (Employer of Record) from Settings > Entities.
 * Entity is the central source of truth for E-Verify, worker type, and onboarding;
 * these settings must flow downward to Accounts, Locations, and Job Orders (read-only there).
 */
import { useEffect, useState, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';

export interface EntitySnapshot {
  id: string;
  name: string;
  entityCode: string;
  workerType: 'W2' | '1099' | 'BOTH';
  everifyRequired: boolean;
  defaultRequirementPackageId?: string | null;
  isActive?: boolean;
}

export function useEntity(tenantId: string | null, entityId: string | null | undefined): {
  entity: EntitySnapshot | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [entity, setEntity] = useState<EntitySnapshot | null>(null);
  const [loading, setLoading] = useState(!!(tenantId && entityId));
  const [error, setError] = useState<string | null>(null);

  const fetchEntity = useCallback(async () => {
    if (!tenantId || !entityId) {
      setEntity(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = doc(db, p.entity(tenantId, entityId));
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setEntity(null);
        return;
      }
      const d = snap.data() as any;
      // Align with backend `resolveEntityContext` / `entities` reads: `name` alone can be empty while `legalName` holds "C1 Select LLC".
      // Placements (and other UIs) derive C1 entity key from this string for `entity_employments` doc ids (`uid__select`, etc.).
      const resolvedName = String(d?.name || d?.legalName || d?.title || '').trim() || snap.id;
      setEntity({
        id: snap.id,
        name: resolvedName,
        entityCode: d?.entityCode ?? '',
        workerType: d?.workerType ?? 'W2',
        everifyRequired: !!d?.everifyRequired,
        defaultRequirementPackageId: d?.defaultRequirementPackageId ?? null,
        isActive: d?.isActive !== false,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load entity');
      setEntity(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityId]);

  useEffect(() => {
    fetchEntity();
  }, [fetchEntity]);

  return { entity, loading, error, refetch: fetchEntity };
}
