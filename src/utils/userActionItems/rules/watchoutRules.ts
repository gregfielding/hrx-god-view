import type { ActionItem } from '../../../types/actionItems';
import { makeActionItem } from '../actionItemFactory';
import type { ActionItemsV1Input } from '../actionItemsV1Input';
import { normalizeRiskProfileFromUserDoc, workerRiskPrimaryLine } from '../../workerRiskProfileDisplay';

export function runWatchoutRules(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];
  const out: ActionItem[] = [];

  const rp = normalizeRiskProfileFromUserDoc(input.riskProfileRaw);
  const line = workerRiskPrimaryLine(rp);
  if (line && rp?.topRisks && rp.topRisks.length > 0) {
    out.push(
      makeActionItem({
        dedupeKey: 'user:risk',
        type: 'risk_watchout',
        category: 'watchout',
        severity: 'medium',
        actor: 'recruiter',
        title: 'Risk or mismatch to review',
        shortDescription: line,
        scope: { kind: 'global' },
        blocking: 'informational',
        sourceType: 'derived',
        sourceId: input.uid,
        ctaLabel: 'Score',
        ctaTarget: { kind: 'profileTab', tab: 'Score' },
        priority: 90,
      }),
    );
  }

  return out;
}
