import { appliedOnDay, getAppliedDays, isIsoDay } from '../applicationDays';

describe('applicationDays', () => {
  it('accepts valid ISO day strings', () => {
    expect(isIsoDay('2026-03-24')).toBe(true);
    expect(isIsoDay('03/24/2026')).toBe(false);
    expect(isIsoDay('')).toBe(false);
  });

  it('prefers applyDates over applyDate and legacy fields', () => {
    const app = {
      applyDates: ['2026-03-24', '2026-03-25'],
      applyDate: '2026-03-23',
      shiftDate: '2026-03-22',
    };
    expect(getAppliedDays(app)).toEqual(['2026-03-24', '2026-03-25']);
  });

  it('falls back to applyDate when applyDates are missing', () => {
    expect(getAppliedDays({ applyDate: '2026-03-24' })).toEqual(['2026-03-24']);
  });

  it('falls back to legacy shiftDates/shiftDate when apply* is missing', () => {
    expect(getAppliedDays({ shiftDates: ['2026-03-24'] })).toEqual(['2026-03-24']);
    expect(getAppliedDays({ shiftDate: '2026-03-25' })).toEqual(['2026-03-25']);
  });

  it('matches selected day correctly', () => {
    const app = { applyDates: ['2026-03-24'] };
    expect(appliedOnDay(app, '2026-03-24')).toBe(true);
    expect(appliedOnDay(app, '2026-03-23')).toBe(false);
  });
});
