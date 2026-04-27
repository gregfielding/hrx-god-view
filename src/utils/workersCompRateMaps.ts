/**
 * Builds lookup maps from tenants/{tenantId}/workers_comp_rates docs.
 * Generic rules (no modifier) use key STATE_lowercasetitle; account-scoped rules use STATE_lowercasetitle_ACCOUNTID.
 */
import type { QuerySnapshot } from 'firebase/firestore';
import type { WorkersCompRateByState } from '../types/recruiter/account';

export type WcRatesByStateAndJobTitle = Record<string, { code: string; rate: number }>;

export type WorkersCompRatesMapsBuilt = {
  byStateAndJobTitle: WcRatesByStateAndJobTitle;
  /** Keys: GA_warehouse associate_ACCOUNTID — account is national parent or standalone id */
  byStateJobTitleAndModifierAccount: WcRatesByStateAndJobTitle;
  wcRatesByStateAndCode: Record<string, number>;
};

export function buildWorkersCompRatesMapsFromSnapshot(snap: QuerySnapshot): WorkersCompRatesMapsBuilt {
  const byStateAndJobTitle: WcRatesByStateAndJobTitle = {};
  const byStateJobTitleAndModifierAccount: WcRatesByStateAndJobTitle = {};
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

    const modifierId = (data.modifierAccountId || '').trim();
    const titles = Array.isArray(data.jobTitles) ? data.jobTitles : [];
    titles.forEach((title) => {
      const t = (title || '').trim().toLowerCase();
      const genKey = `${state}_${t}`;
      if (genKey === `${state}_`) return;
      if (modifierId) {
        byStateJobTitleAndModifierAccount[`${genKey}_${modifierId}`] = { code, rate };
      } else {
        byStateAndJobTitle[genKey] = { code, rate };
      }
    });
  });

  return { byStateAndJobTitle, byStateJobTitleAndModifierAccount, wcRatesByStateAndCode };
}

/** Resolve WC national/standalone modifier id for job order / pricing (child → parent national). */
export function resolveWorkersCompModifierAccountId(account: {
  id?: string;
  parentAccountId?: string | null;
} | null | undefined): string | null {
  if (!account?.id) return null;
  const parent = (account.parentAccountId || '').trim();
  return parent || account.id;
}

export function pickWorkersCompJobTitleLookup(
  maps: Pick<WorkersCompRatesMapsBuilt, 'byStateAndJobTitle' | 'byStateJobTitleAndModifierAccount'>,
  stateCode: string,
  jobTitle: string,
  modifierAccountId: string | null | undefined,
): { code: string; rate: number } | undefined {
  const state = stateCode.trim().toUpperCase();
  const title = jobTitle.trim().toLowerCase();
  const genericKey = `${state}_${title}`;
  const mod = (modifierAccountId || '').trim();
  if (mod) {
    const scoped = maps.byStateJobTitleAndModifierAccount[`${genericKey}_${mod}`];
    if (scoped) return scoped;
  }
  return maps.byStateAndJobTitle[genericKey];
}
