/**
 * One admin TempWorks verification control per `externalOnboardingSteps` business key.
 * Picks a single Settings workflow row (`row.stepKey`) to host the control when several rows map to the same external key.
 */

import type { OnboardingPathGroup } from '../pages/UserProfile/components/employment-v2/employmentV2Types';
import type { ExternalOnboardingStepKey } from '../types/externalOnboardingSteps';
import { isExternalOnboardingStepVerificationUiKey } from './externalOnboardingSteps';
import { ONBOARDING_WORKFLOW_STEPS } from './onboardingWorkflowStepCatalog';

const WORKFLOW_CATALOG_INDEX = new Map(ONBOARDING_WORKFLOW_STEPS.map((d, i) => [d.id, i] as const));

function workflowStepCatalogIndex(workflowStepId: string): number {
  return WORKFLOW_CATALOG_INDEX.get(workflowStepId) ?? 9999;
}

/**
 * Completion-shaped checkbox ids per external business key (preferred anchor when multiple rows share the key).
 * Order in `ONBOARDING_WORKFLOW_STEPS` breaks ties when several completion ids are visible (e.g. W-9 paths).
 */
export const EXTERNAL_VERIFICATION_COMPLETION_WORKFLOW_STEP_IDS: Partial<
  Record<ExternalOnboardingStepKey, ReadonlySet<string>>
> = {
  payroll_onboarding: new Set(['payroll_setup_complete']),
  direct_deposit: new Set(['direct_deposit_w2', 'direct_deposit_contractor']),
  tax_withholding_forms: new Set(['w4_completed']),
  contractor_tax_form_w9: new Set(['1099_completed', 'w9_received']),
  i9_employee_section: new Set(['i9_completed']),
  independent_contractor_agreement: new Set(['ic_agreement_signed']),
};

/**
 * Deterministic anchor: first completion-style id in catalog order among visible candidates; else earliest catalog id.
 */
export function pickExternalVerificationAnchorWorkflowStepId(
  externalKey: ExternalOnboardingStepKey,
  visibleWorkflowStepIds: readonly string[]
): string | null {
  const unique = [...new Set(visibleWorkflowStepIds.filter(Boolean))];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];

  const sorted = unique.sort((a, b) => workflowStepCatalogIndex(a) - workflowStepCatalogIndex(b));
  const completion = EXTERNAL_VERIFICATION_COMPLETION_WORKFLOW_STEP_IDS[externalKey];
  if (completion) {
    for (const id of sorted) {
      if (completion.has(id)) return id;
    }
  }
  return sorted[0];
}

/** Map external business key → Settings workflow step id (`EmploymentOnboardingRow.stepKey`) that hosts verification UI. */
export function buildExternalVerificationAnchorByExternalKey(
  groups: OnboardingPathGroup[]
): ReadonlyMap<ExternalOnboardingStepKey, string> {
  const candidates = new Map<ExternalOnboardingStepKey, Set<string>>();

  for (const g of groups) {
    for (const row of g.rows) {
      if (row.sourceType !== 'external_onboarding') continue;
      const ext = row.sourceRef?.externalStepKey;
      if (!ext || !isExternalOnboardingStepVerificationUiKey(ext)) continue;
      const set = candidates.get(ext) ?? new Set<string>();
      set.add(row.stepKey);
      candidates.set(ext, set);
    }
  }

  const out = new Map<ExternalOnboardingStepKey, string>();
  for (const [ext, set] of candidates) {
    const anchor = pickExternalVerificationAnchorWorkflowStepId(ext, [...set]);
    if (anchor) out.set(ext, anchor);
  }
  return out;
}
