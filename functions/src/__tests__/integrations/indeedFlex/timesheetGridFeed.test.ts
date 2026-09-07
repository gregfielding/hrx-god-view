import { hhmmFromOffsetIso, planPunchFields } from '../../../integrations/indeedFlex/timesheetGridFeed';

describe('timesheetGridFeed pure helpers', () => {
  test('hhmmFromOffsetIso reads the venue-local wall time, ignoring the offset', () => {
    expect(hhmmFromOffsetIso('2026-09-05T10:02:00-06:00')).toBe('10:02');
    expect(hhmmFromOffsetIso('2026-09-05T23:45:11+01:00')).toBe('23:45');
    expect(hhmmFromOffsetIso(null)).toBeNull();
    expect(hhmmFromOffsetIso('garbage')).toBeNull();
  });

  test('fills empty fields on first sync', () => {
    const plan = planPunchFields({}, undefined, { actualStartTime: '10:02', actualEndTime: null, breakMinutes: null });
    expect(plan).toEqual({ actualStartTime: '10:02', skippedManual: [] });
  });

  test('adds the clock-out later without touching the clock-in', () => {
    const plan = planPunchFields(
      { actualStartTime: '10:02' },
      { actualStartTime: '10:02' },
      { actualStartTime: '10:02', actualEndTime: '16:31', breakMinutes: 30 },
    );
    expect(plan).toEqual({ actualEndTime: '16:31', breakMinutes: 30, skippedManual: [] });
  });

  test('replaces a value we applied when Flex corrects it', () => {
    const plan = planPunchFields(
      { actualStartTime: '10:02', actualEndTime: '16:31' },
      { actualStartTime: '10:02', actualEndTime: '16:31' },
      { actualStartTime: '10:00', actualEndTime: '16:31', breakMinutes: null },
    );
    expect(plan).toEqual({ actualStartTime: '10:00', skippedManual: [] });
  });

  test('never overwrites a recruiter hand edit', () => {
    const plan = planPunchFields(
      { actualStartTime: '09:55', actualEndTime: '16:31' },
      { actualStartTime: '10:02', actualEndTime: '16:31' },
      { actualStartTime: '10:00', actualEndTime: '16:45', breakMinutes: null },
    );
    expect(plan.actualStartTime).toBeUndefined();
    expect(plan.actualEndTime).toBe('16:45');
    expect(plan.skippedManual).toEqual(['actualStartTime']);
  });

  test('does not re-apply an unchanged break', () => {
    const plan = planPunchFields({ flexBreakMinutes: 30 }, { breakMinutes: 30 }, { actualStartTime: null, actualEndTime: null, breakMinutes: 30 });
    expect(plan).toEqual({ skippedManual: [] });
  });
});
