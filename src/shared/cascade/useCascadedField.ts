/**
 * Cascading Order Data — React hook for one cascaded field
 * (handoff §6 + O.4 slice).
 *
 * Loads the JO/shift cascade chain, resolves one field, and returns
 * `{ value, provenance, chain, loading, error, refresh }`. Callers
 * pass a stable target so the hook re-fetches only on real change.
 *
 * The hook owns its own `LoaderContext`, so multiple
 * `useCascadedField` calls inside the same component share doc reads
 * via React's render-batching only if you reuse the returned chain.
 * For the Instructions-tab fan-out we resolve `staffInstructions`
 * once and slice provenance per-key client-side via
 * {@link provenanceForKey} — much cheaper than 7 separate hooks.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AncestorLevel,
  type ProvenanceEntry,
} from './types';
import type { CascadingFieldKey } from './registry';
import { resolveCascadedField } from './resolveCascadedField';
import {
  type ChainTarget,
  createLoaderContext,
  loadCascadeChain,
} from './loaders';

export interface UseCascadedFieldResult<T = unknown> {
  /** Resolved value. `undefined` while loading or when no level contributed. */
  value: T | undefined;
  /** Per-level provenance trail. Empty until the chain has loaded. */
  provenance: ProvenanceEntry[];
  /** Ancestor → target chain. Empty until loaded. */
  chain: AncestorLevel[];
  loading: boolean;
  error: Error | null;
  /**
   * Force a refetch. Call after any write that should change the
   * resolved value (the shift drawer's existing instruction-card
   * `onRefresh` callback hooks into this).
   */
  refresh: () => void;
}

/**
 * @param field      Registered cascade key.
 * @param target     `{ tenantId, jobOrderId, shiftId? }`. Pass
 *                   `null` to keep the hook idle (e.g. before the
 *                   drawer mounts).
 */
export function useCascadedField<K extends CascadingFieldKey>(
  field: K,
  target: ChainTarget | null,
): UseCascadedFieldResult {
  const [chain, setChain] = useState<AncestorLevel[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  // Bumping `tick` forces the load effect to re-run for refresh().
  const [tick, setTick] = useState(0);

  // Snapshot the active request so a slow first request can't
  // overwrite a fresher result if the user toggles drawers fast.
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!target || !target.tenantId || !target.jobOrderId) {
      setChain([]);
      setLoading(false);
      setError(null);
      return;
    }
    const myReqId = ++reqIdRef.current;
    const ctx = createLoaderContext();
    setLoading(true);
    setError(null);
    loadCascadeChain(ctx, target)
      .then((next) => {
        if (myReqId !== reqIdRef.current) return; // stale
        setChain(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (myReqId !== reqIdRef.current) return; // stale
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [target?.tenantId, target?.jobOrderId, target?.shiftId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolved = useMemo(() => {
    if (chain.length === 0) {
      return { value: undefined as unknown, provenance: [] as ProvenanceEntry[] };
    }
    return resolveCascadedField(field, chain);
  }, [field, chain]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return {
    value: resolved.value,
    provenance: resolved.provenance,
    chain,
    loading,
    error,
    refresh,
  };
}
