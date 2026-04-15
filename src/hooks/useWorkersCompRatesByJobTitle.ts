/**
 * Loads tenant workers_comp_rates and builds:
 * - By (state, jobTitle) for auto-applying WC when job title + worksite state match
 * - By (state, class code) so Account Pricing–style rows that store code but derive rate from master still resolve on job orders
 */
import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { p } from '../data/firestorePaths';
import type { WorkersCompRateByState } from '../types/recruiter/account';

export type WcRatesByStateAndJobTitle = Record<string, { code: string; rate: number }>;

export type WorkersCompRatesMaps = {
  byStateAndJobTitle: WcRatesByStateAndJobTitle;
  /** Keys: STATE_CODE (e.g. TX_9079), same as Firestore doc id under workers_comp_rates */
  wcRatesByStateAndCode: Record<string, number>;
};

export function useWorkersCompRatesByJobTitle(
  tenantId: string | null | undefined,
): WorkersCompRatesMaps {
  const [maps, setMaps] = useState<WorkersCompRatesMaps>({
    byStateAndJobTitle: {},
    wcRatesByStateAndCode: {},
  });

  const load = useCallback(async () => {
    if (!tenantId) {
      setMaps({ byStateAndJobTitle: {}, wcRatesByStateAndCode: {} });
      return;
    }
    try {
      const snap = await getDocs(collection(db, p.workersCompRates(tenantId)));
      const byStateAndJobTitle: WcRatesByStateAndJobTitle = {};
      const wcRatesByStateAndCode: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as WorkersCompRateByState;
        const state = (data.state || '').trim().toUpperCase();
        const code = (data.code || '').trim();
        const rate = Number(data.rate);
        if (!state || !code || Number.isNaN(rate)) return;
        const compositeKey = `${state}_${code}`;
        wcRatesByStateAndCode[compositeKey] = rate;
        if (d.id) {
          wcRatesByStateAndCode[d.id] = rate;
        }
        const titles = Array.isArray(data.jobTitles) ? data.jobTitles : [];
        titles.forEach((title) => {
          const key = `${state}_${(title || '').trim().toLowerCase()}`;
          if (key !== `${state}_`) byStateAndJobTitle[key] = { code, rate };
        });
      });
      setMaps({ byStateAndJobTitle, wcRatesByStateAndCode });
    } catch {
      setMaps({ byStateAndJobTitle: {}, wcRatesByStateAndCode: {} });
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  return maps;
}
