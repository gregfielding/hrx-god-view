import { dailyConfirmDayRows, isDailyConfirmAssignment } from '../dailyConfirmDays';

const ts = (ms: number) => ({ toMillis: () => ms });

describe('dailyConfirmDayRows', () => {
  const assignment = {
    cortConfirmation: { dailyConfirm: true, state: 'confirmed', workDate: '2026-09-14' },
    cortConfirmationDays: {
      '2026-09-16': { state: 'PENDING', startTime: '05:00', endTime: '13:30' },
      '2026-09-14': { state: 'confirmed', startTime: '05:00', endTime: '13:30', startAt: ts(1789380000000) },
      '2026-09-20': { state: 'pending', startTime: '05:00' },
      notADate: { state: 'pending' },
    },
  };

  it('returns only days inside the window, oldest first, with normalized state', () => {
    const rows = dailyConfirmDayRows(assignment, '2026-09-14', '2026-09-17');
    expect(rows.map((r) => [r.workDate, r.state])).toEqual([
      ['2026-09-14', 'confirmed'],
      ['2026-09-16', 'pending'],
    ]);
    expect(rows[0].startMs).toBe(1789380000000);
    expect(rows[1].startMs).toBeNull();
  });

  it('isDailyConfirmAssignment reads the mirror flag only', () => {
    expect(isDailyConfirmAssignment(assignment)).toBe(true);
    expect(isDailyConfirmAssignment({ cortConfirmation: { state: 'pending' } })).toBe(false);
    expect(isDailyConfirmAssignment(undefined)).toBe(false);
    expect(dailyConfirmDayRows({}, '2026-09-01', '2026-09-30')).toEqual([]);
  });
});
