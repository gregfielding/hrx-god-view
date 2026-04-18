import {
  applyPrescreenDynamicDedupe,
  DYN_PHYSICAL_JOB_FIT_ID,
  DYN_SHIFT_PUNCTUALITY_ID,
  DYN_WORKSITE_COMMUTE_ID,
} from './prescreenDynamicDedupe';

describe('applyPrescreenDynamicDedupe', () => {
  const plan = [
    { id: DYN_SHIFT_PUNCTUALITY_ID },
    { id: DYN_WORKSITE_COMMUTE_ID },
    { id: DYN_PHYSICAL_JOB_FIT_ID },
  ];

  it('skips physical job fit when core physical_comfort is yes', () => {
    const { visibleSteps, mergedDynamicAnswers, skipped } = applyPrescreenDynamicDedupe(plan, { physical_comfort: 'yes' }, {});
    expect(skipped.some((s) => s.id === DYN_PHYSICAL_JOB_FIT_ID)).toBe(true);
    expect(mergedDynamicAnswers[DYN_PHYSICAL_JOB_FIT_ID]).toBe('yes');
    expect(visibleSteps.map((s) => s.id)).not.toContain(DYN_PHYSICAL_JOB_FIT_ID);
  });

  it('skips shift when attendance clear and transport reliable', () => {
    const { visibleSteps, skipped } = applyPrescreenDynamicDedupe(
      plan,
      {
        attendance_issues: 'no',
        transportation_plan: 'own_vehicle',
        backup_transportation: 'yes',
      },
      {},
    );
    expect(skipped.some((s) => s.id === DYN_SHIFT_PUNCTUALITY_ID)).toBe(true);
    expect(visibleSteps.map((s) => s.id)).not.toContain(DYN_SHIFT_PUNCTUALITY_ID);
  });

  it('skips commute after shift answered yes (merged order)', () => {
    const { visibleSteps, skipped } = applyPrescreenDynamicDedupe(
      plan,
      {
        attendance_issues: 'yes',
        transportation_plan: 'not_sure_yet',
        backup_transportation: 'no',
      },
      { [DYN_SHIFT_PUNCTUALITY_ID]: 'yes' },
    );
    expect(skipped.some((s) => s.reason === 'dedupe:after_shift_punctuality_yes')).toBe(true);
    expect(visibleSteps.map((s) => s.id)).not.toContain(DYN_WORKSITE_COMMUTE_ID);
  });

  it('skips commute when transport reliable without shift answer', () => {
    const { skipped } = applyPrescreenDynamicDedupe(
      plan,
      {
        attendance_issues: 'yes',
        transportation_plan: 'public_transportation',
        backup_transportation: 'yes',
      },
      {},
    );
    expect(skipped.some((s) => s.id === DYN_WORKSITE_COMMUTE_ID)).toBe(true);
  });
});
