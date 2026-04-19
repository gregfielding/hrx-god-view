import type { ActionItem } from '../../../types/actionItems';
import { makeActionItem } from '../actionItemFactory';
import type { ActionItemsV1Input } from '../actionItemsV1Input';

export function runEntityOnboardingRules(input: ActionItemsV1Input): ActionItem[] {
  if (!input.enabled) return [];

  const out: ActionItem[] = [];

  for (const row of input.entityItems) {
    const key = String(row.entityKey || row.entityLabel || 'entity').toLowerCase();
    const dedupeBase = `entity:${key}`;

    if (row.tone === 'onboarding' || row.tone === 'needs_attention') {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupeBase}:onboarding`,
          type: 'onboarding_incomplete_entity',
          category: 'entity_onboarding',
          severity: row.tone === 'needs_attention' ? 'high' : 'medium',
          actor: 'worker',
          title: `Finish ${row.entityLabel} onboarding`,
          shortDescription: row.statusLabel
            ? `${row.statusLabel}. Complete the remaining steps on Employment.`
            : 'Company onboarding still has open steps on Employment.',
          scope: { kind: 'entity', entityId: key, entityLabel: row.entityLabel },
          blocking: row.tone === 'needs_attention' ? 'hard' : 'soft',
          sourceType: 'derived',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'profileTab', tab: 'Employment' },
          priority: row.tone === 'needs_attention' ? 12 : 25,
        }),
      );
    }
  }

  for (const s of input.entitySignals) {
    const dedupe = s.dedupeKey;

    if (s.payrollIncomplete) {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupe}:payroll`,
          type: 'payroll_or_tax_or_deposit_incomplete',
          category: 'entity_onboarding',
          severity: 'medium',
          actor: 'worker',
          title: `Payroll or tax setup open — ${s.entityLabel}`,
          shortDescription: 'Tax, banking, or deposits still need to be finished for this employer.',
          scope: { kind: 'entity', entityId: s.entityKey, entityLabel: s.entityLabel },
          blocking: 'soft',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'profileTab', tab: 'Employment' },
          priority: 30,
        }),
      );
    }

    if (s.i9Incomplete) {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupe}:i9`,
          type: 'i9_incomplete',
          category: 'entity_onboarding',
          severity: 'high',
          actor: 'worker',
          title: `Complete I-9 for ${s.entityLabel}`,
          shortDescription: 'Tax and identity (I-9) are not finished for this employer yet.',
          scope: { kind: 'entity', entityId: s.entityKey, entityLabel: s.entityLabel },
          blocking: 'hard',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'anchor', tab: 'Employment', hash: 'i9' },
          priority: 10,
        }),
      );
    }

    if (s.everifyBucket === 'not_started') {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupe}:everify_ns`,
          type: 'everify_not_started',
          category: 'work_eligibility',
          severity: 'medium',
          actor: 'worker',
          title: `${s.entityLabel}: E-Verify not started`,
          shortDescription: 'Start E-Verify when I-9 prerequisites are satisfied.',
          scope: { kind: 'entity', entityId: s.entityKey, entityLabel: s.entityLabel },
          blocking: 'soft',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'profileTab', tab: 'Employment' },
          priority: 35,
        }),
      );
    } else if (s.everifyBucket === 'pending') {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupe}:everify_pend`,
          type: 'everify_pending',
          category: 'work_eligibility',
          severity: 'medium',
          actor: 'system',
          title: `E-Verify in progress — ${s.entityLabel}`,
          shortDescription: 'The case is still running; watch for USCIS updates.',
          scope: { kind: 'entity', entityId: s.entityKey, entityLabel: s.entityLabel },
          blocking: 'soft',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'profileTab', tab: 'Employment' },
          priority: 36,
        }),
      );
    } else if (s.everifyBucket === 'action_required') {
      out.push(
        makeActionItem({
          dedupeKey: `${dedupe}:everify_act`,
          type: 'everify_action_required',
          category: 'work_eligibility',
          severity: 'high',
          actor: 'recruiter',
          title: `E-Verify needs attention — ${s.entityLabel}`,
          shortDescription: 'Resolve referrals, TNCs, or other case exceptions in Employment.',
          scope: { kind: 'entity', entityId: s.entityKey, entityLabel: s.entityLabel },
          blocking: 'hard',
          sourceType: 'user_doc',
          sourceId: input.uid,
          ctaLabel: 'Employment',
          ctaTarget: { kind: 'profileTab', tab: 'Employment' },
          priority: 11,
        }),
      );
    }
  }

  return out;
}
