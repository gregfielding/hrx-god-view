/**
 * RA.1 — pin 1099 contractor I-9 suppression behavior.
 *
 * The canonical onboarding step matrix (`docs/CANONICAL_ONBOARDING_STEP_MATRIX.md`)
 * marks `i9_supporting_documents` as `not_required` when `workerType === '1099'`.
 * The server mirrors this in `functions/src/onboarding/workerOnboardingPipeline.ts`
 * via `computeStepApplicability`. Before RA.1, the client Action Item generator
 * ignored `workerType` entirely and emitted `i9_incomplete` for every
 * `entity_employments` row whose `taxIdentityStatus` wasn't `complete` —
 * including 1099 contractors who never have an I-9. That produced the
 * spurious "Complete I-9 for C1 Events" recruiter task documented in the
 * Action Items + Readiness audit (RA.0, Bug #1).
 *
 * These tests pin the post-RA.1 gate. Any future change that drops the
 * `workerType !== '1099'` check will fail the 1099 case and force a fresh
 * decision.
 */

import { runEntityOnboardingRules } from '../entityOnboardingRules';
import type { ActionItemsV1Input } from '../../actionItemsV1Input';
import type { EntityEmploymentActionSignal } from '../../entitySignalsFromEmploymentDocs';

function buildSignal(
  overrides: Partial<EntityEmploymentActionSignal>,
): EntityEmploymentActionSignal {
  return {
    dedupeKey: 'entity:c1_events_llc',
    entityKey: 'c1_events_llc',
    entityLabel: 'C1 Events LLC',
    onboardingIncomplete: true,
    payrollIncomplete: false,
    i9Incomplete: true,
    everifyBucket: 'ok',
    assignments: [],
    workerType: null,
    ...overrides,
  };
}

function buildInput(signals: EntityEmploymentActionSignal[]): ActionItemsV1Input {
  return {
    uid: 'u-test',
    enabled: true,
    phoneVerified: true,
    phone: '+15555550100',
    hasInterview: true,
    workAuthorized: true,
    scoreSummary: undefined,
    riskProfileRaw: null,
    entityItems: [],
    entitySignals: signals,
    backgroundCheckOrders: [],
    certifications: [],
    actionSignalsReady: true,
  };
}

describe('runEntityOnboardingRules — RA.1 workerType gate on i9_incomplete', () => {
  it('SUPPRESSES i9_incomplete for 1099 contractor entity employments', () => {
    const items = runEntityOnboardingRules(
      buildInput([buildSignal({ workerType: '1099', i9Incomplete: true })]),
    );
    const i9 = items.filter((it) => it.type === 'i9_incomplete');
    expect(i9).toHaveLength(0);
  });

  it('STILL emits i9_incomplete for w2 employee entity employments', () => {
    const items = runEntityOnboardingRules(
      buildInput([buildSignal({ workerType: 'w2', i9Incomplete: true })]),
    );
    const i9 = items.filter((it) => it.type === 'i9_incomplete');
    expect(i9).toHaveLength(1);
    expect(i9[0].title).toContain('I-9');
    expect(i9[0].title).toContain('C1 Events');
  });

  it('STILL emits i9_incomplete when workerType is missing (legacy data → W-2 default)', () => {
    const items = runEntityOnboardingRules(
      buildInput([buildSignal({ workerType: null, i9Incomplete: true })]),
    );
    const i9 = items.filter((it) => it.type === 'i9_incomplete');
    expect(i9).toHaveLength(1);
  });

  it('1099 contractor still gets payroll_or_tax_or_deposit_incomplete (W-9 + bank ARE required for 1099)', () => {
    const items = runEntityOnboardingRules(
      buildInput([
        buildSignal({
          workerType: '1099',
          i9Incomplete: true,
          payrollIncomplete: true,
        }),
      ]),
    );
    expect(items.filter((it) => it.type === 'i9_incomplete')).toHaveLength(0);
    expect(items.filter((it) => it.type === 'payroll_or_tax_or_deposit_incomplete')).toHaveLength(1);
  });

  it('mixed entities — 1099 row suppressed, W-2 row still emits', () => {
    const items = runEntityOnboardingRules(
      buildInput([
        buildSignal({
          dedupeKey: 'entity:c1_events_llc',
          entityKey: 'c1_events_llc',
          entityLabel: 'C1 Events LLC',
          workerType: '1099',
          i9Incomplete: true,
        }),
        buildSignal({
          dedupeKey: 'entity:c1_select_llc',
          entityKey: 'c1_select_llc',
          entityLabel: 'C1 Select LLC',
          workerType: 'w2',
          i9Incomplete: true,
        }),
      ]),
    );
    const i9 = items.filter((it) => it.type === 'i9_incomplete');
    expect(i9).toHaveLength(1);
    expect(i9[0].title).toContain('C1 Select');
    expect(i9[0].title).not.toContain('C1 Events');
  });
});
