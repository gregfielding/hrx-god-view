/**
 * RA.2 — defense-in-depth fallback for stale per-section status fields.
 *
 * Bug #2 in the action-items-readiness audit (RA.0): the
 * "Payroll or tax setup open — C1 Events" Action Item kept firing for
 * workers who had completed payroll onboarding in Everee, because:
 *
 *   1. The client signal builder reads `entity_employments.payrollStatus`
 *      to decide `payrollIncomplete`.
 *   2. The server-side mirror only wrote the lifecycle bits
 *      (`status`, `active`, `evereeOnboardingStatus`); `payrollStatus`
 *      was left at its stale wizard value.
 *   3. Even when the mirror is fixed (RA.2 server change), legacy rows
 *      and rows where the mirror failed mid-write (Everee webhook 401s
 *      etc.) can still carry stale `payrollStatus` while
 *      `evereeOnboardingStatus === 'complete'` or
 *      `payrollOnboardingCompletedAt` is set.
 *
 * The client-side fallback in `entitySignalsFromEmploymentDocs.ts` treats
 * those Everee-completion signals as authoritative when present: if Everee
 * has reported completion, payroll setup is necessarily done (Everee's
 * onboarding flow includes payroll for both W-2 and 1099). These tests
 * pin that behavior so a future revert that drops the fallback can't
 * silently re-introduce Bug #2.
 */

import { buildEntityEmploymentActionSignals } from '../entitySignalsFromEmploymentDocs';
import type { EntityEmploymentDocSnap } from '../../userListEntityEmploymentStatus';

function buildDoc(id: string, data: Record<string, unknown>): EntityEmploymentDocSnap {
  return {
    id,
    data: () => data,
  };
}

describe('buildEntityEmploymentActionSignals — RA.2 evereeReportedComplete fallback', () => {
  it('STALE payrollStatus is overridden when evereeOnboardingStatus === "complete"', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_events_llc',
          entityName: 'C1 Events LLC',
          payrollStatus: 'in_progress', // stale wizard value
          taxIdentityStatus: 'not_started', // stale wizard value
          evereeOnboardingStatus: 'complete', // RA.2 mirror wrote this
          workerType: '1099',
        }),
      ],
      {} as never,
    );
    expect(signals).toHaveLength(1);
    const s = signals[0];
    expect(s.payrollIncomplete).toBe(false);
    expect(s.i9Incomplete).toBe(false);
  });

  it('STALE payrollStatus is overridden when payrollOnboardingCompletedAt is set', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_events_llc',
          entityName: 'C1 Events LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          payrollOnboardingCompletedAt: { _seconds: 1700000000, _nanoseconds: 0 },
          workerType: '1099',
        }),
      ],
      {} as never,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].payrollIncomplete).toBe(false);
    expect(signals[0].i9Incomplete).toBe(false);
  });

  it('still reports payrollIncomplete when neither completion signal is present', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_select_llc',
          entityName: 'C1 Select LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          // no evereeOnboardingStatus, no payrollOnboardingCompletedAt
          workerType: 'w2',
        }),
      ],
      {} as never,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].payrollIncomplete).toBe(true);
    expect(signals[0].i9Incomplete).toBe(true);
  });

  it('payrollIncomplete is false when payrollStatus is already "complete" (mirror succeeded)', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_select_llc',
          entityName: 'C1 Select LLC',
          payrollStatus: 'complete',
          taxIdentityStatus: 'complete',
          workerType: 'w2',
        }),
      ],
      {} as never,
    );
    expect(signals).toHaveLength(1);
    expect(signals[0].payrollIncomplete).toBe(false);
    expect(signals[0].i9Incomplete).toBe(false);
  });

  it('manual I-9 stamp continues to clear i9Incomplete independently of Everee signals', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_select_llc',
          entityName: 'C1 Select LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          i9SupportingDocumentsManualCompleteAt: { _seconds: 1700000000, _nanoseconds: 0 },
          workerType: 'w2',
        }),
      ],
      {} as never,
    );
    expect(signals[0].i9Incomplete).toBe(false);
    // Payroll still incomplete — manual I-9 doesn't speak to payroll.
    expect(signals[0].payrollIncomplete).toBe(true);
  });

  it('workerType is surfaced for downstream rule gating (RA.1)', () => {
    const signals = buildEntityEmploymentActionSignals(
      [
        buildDoc('ee-1', {
          entityKey: 'c1_events_llc',
          entityName: 'C1 Events LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          workerType: '1099',
        }),
        buildDoc('ee-2', {
          entityKey: 'c1_select_llc',
          entityName: 'C1 Select LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          workerType: 'w2',
        }),
        buildDoc('ee-3', {
          entityKey: 'c1_workforce_llc',
          entityName: 'C1 Workforce LLC',
          payrollStatus: 'in_progress',
          taxIdentityStatus: 'in_progress',
          // workerType omitted → null → treated as W-2 default at rule layer.
        }),
      ],
      {} as never,
    );
    expect(signals.find((s) => s.entityKey === 'c1_events_llc')?.workerType).toBe('1099');
    expect(signals.find((s) => s.entityKey === 'c1_select_llc')?.workerType).toBe('w2');
    expect(signals.find((s) => s.entityKey === 'c1_workforce_llc')?.workerType).toBe(null);
  });
});
