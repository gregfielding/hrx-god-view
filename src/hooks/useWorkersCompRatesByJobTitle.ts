/**
 * Loads tenant workers_comp_rates and builds a lookup map by (state, jobTitle) for auto-applying
 * WC code and rate when an account or job order uses a job title and worksite state.
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { WorkersCompRateByState } from '../types/recruiter/account';

export type WcRatesByStateAndJobTitle = Record<string, { code: string; rate: number }>;

export function useWorkersCompRatesByJobTitle(tenantId: string | null | undefined): WcRatesByStateAndJobTitle {
  const [byStateAndJobTitle, setByStateAndJobTitle] = useState<WcRatesByStateAndJobTitle>({});

  const load = useCallback(async () => {
    if (!tenantId) {
      setByStateAndJobTitle({});
      return;
    }
    try {
      const snap = await getDocs(collection(db, p.workersCompRates(tenantId)));
      const map: WcRatesByStateAndJobTitle = {};
      snap.docs.forEach((d) => {
        const data = d.data() as WorkersCompRateByState;
        const state = (data.state || '').trim().toUpperCase();
        const code = (data.code || '').trim();
        const rate = Number(data.rate);
        if (!state || !code || Number.isNaN(rate)) return;
        const titles = Array.isArray(data.jobTitles) ? data.jobTitles : [];
        titles.forEach((title) => {
          const key = `${state}_${(title || '').trim().toLowerCase()}`;
          if (key !== `${state}_`) map[key] = { code, rate };
        });
      });
      setByStateAndJobTitle(map);
    } catch {
      setByStateAndJobTitle({});
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return byStateAndJobTitle;
}
