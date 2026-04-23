/**
 * Loads tenant workers_comp_rates and builds:
 * - By (state, jobTitle) for auto-applying WC when job title + worksite state match (no account modifier)
 * - By (state, jobTitle, nationalOrStandaloneAccountId) when a rate row is scoped to an account
 * - By (state, class code) so Account Pricing–style rows that store code but derive rate from master still resolve on job orders
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import {
  buildWorkersCompRatesMapsFromSnapshot,
  type WorkersCompRatesMapsBuilt,
  type WcRatesByStateAndJobTitle,
} from '../utils/workersCompRateMaps';

export type { WcRatesByStateAndJobTitle };
export type WorkersCompRatesMaps = WorkersCompRatesMapsBuilt;

export function useWorkersCompRatesByJobTitle(
  tenantId: string | null | undefined,
): WorkersCompRatesMaps {
  const [maps, setMaps] = useState<WorkersCompRatesMaps>({
    byStateAndJobTitle: {},
    byStateJobTitleAndModifierAccount: {},
    wcRatesByStateAndCode: {},
  });

  const load = useCallback(async () => {
    if (!tenantId) {
      setMaps({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {}, wcRatesByStateAndCode: {} });
      return;
    }
    try {
      const snap = await getDocs(collection(db, p.workersCompRates(tenantId)));
      setMaps(buildWorkersCompRatesMapsFromSnapshot(snap));
    } catch {
      setMaps({ byStateAndJobTitle: {}, byStateJobTitleAndModifierAccount: {}, wcRatesByStateAndCode: {} });
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return maps;
}
