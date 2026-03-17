import {
  applicationHasShiftMetadata,
  applicationMatchesAnyShift,
  applicationMatchesSelectedDay,
  applicationMatchesShift,
  assignmentMatchesSelectedDay,
  buildAppliedKeysForApplication,
  getApplicationShiftIds,
  hasDaySpecificKeyForShift,
} from '../gigShiftState';

describe('gigShiftState', () => {
  it('extracts shift ids from shiftId/shiftIds/selectedShifts', () => {
    const ids = getApplicationShiftIds({
      shiftId: 's1',
      shiftIds: ['s2'],
      selectedShifts: ['s3', { shiftId: 's4' }, { id: 's5' }],
    });
    expect(ids.sort()).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('matches shift and any-shift correctly', () => {
    const app = { shiftIds: ['a', 'b'] };
    expect(applicationHasShiftMetadata(app)).toBe(true);
    expect(applicationMatchesShift(app, 'b')).toBe(true);
    expect(applicationMatchesAnyShift(app, ['x', 'b'])).toBe(true);
    expect(applicationMatchesAnyShift(app, ['x', 'y'])).toBe(false);
  });

  it('matches selected day using canonical day extraction', () => {
    const app = { applyDates: ['2026-03-24'] };
    expect(applicationMatchesSelectedDay(app, '2026-03-24')).toBe(true);
    expect(applicationMatchesSelectedDay(app, '2026-03-23')).toBe(false);
  });

  it('builds applied keys for day-specific multi-day shifts without shift-level key', () => {
    const app = { shiftId: 'shift-1', applyDates: ['2026-03-24'] };
    const keys = buildAppliedKeysForApplication(app, new Set(['shift-1']));
    expect(keys).toContain('shift-1__2026-03-24');
    expect(keys).not.toContain('shift-1');
  });

  it('builds shift-level key for non-day-specific or non-multiday shifts', () => {
    expect(
      buildAppliedKeysForApplication({ shiftId: 'shift-2' }, new Set(['shift-2'])),
    ).toEqual(['shift-2']);
    expect(
      buildAppliedKeysForApplication({ shiftId: 'shift-3', applyDate: '2026-03-24' }, new Set()),
    ).toEqual(['shift-3__2026-03-24', 'shift-3']);
  });

  it('detects day-specific keys for a shift', () => {
    expect(hasDaySpecificKeyForShift(['s1__2026-03-24'], 's1')).toBe(true);
    expect(hasDaySpecificKeyForShift(['s1'], 's1')).toBe(false);
  });

  it('matches assignment day only for selected day on multi-day gigs', () => {
    expect(assignmentMatchesSelectedDay({ startDate: '2026-03-24' }, '2026-03-24', true)).toBe(true);
    expect(assignmentMatchesSelectedDay({ startDate: '2026-03-25' }, '2026-03-24', true)).toBe(false);
    expect(assignmentMatchesSelectedDay({ startDate: '2026-03-25' }, '2026-03-24', false)).toBe(true);
  });
});
