/**
 * Reply routing for daily-confirm crews (2026-09-11). One Woodridge
 * assignment runs Mon–Fri indefinitely; the inbound handler expands it into
 * one cadence per workday so a YES lands on exactly one day.
 */

import { pickPendingCadence, type ActiveCadence } from '../cadenceReplyHandler';
import { expandDailyCadenceDays } from '../dailyConfirm';

const HOUR = 60 * 60 * 1000;
const ts = (ms: number) => ({ toMillis: () => ms });

function crewCadences(days: Record<string, Record<string, unknown>>): ActiveCadence[] {
  const assignment = { cortConfirmation: { dailyConfirm: true }, cortConfirmationDays: days };
  const now = Date.now();
  return expandDailyCadenceDays(assignment, now - 24 * HOUR, now + 5 * 24 * HOUR).map((d) => ({
    tenantId: 'T',
    assignmentId: 'woodridge_crew_member',
    assignment,
    startMs: d.startMs,
    state: d.state,
    lastAskedAtMs: d.lastAskedAtMs,
    workDate: d.workDate,
    workStartTime: d.startTime,
  }));
}

describe('daily-confirm reply routing', () => {
  test('a YES right after the Tuesday ask binds to Tuesday — not Monday, not Wednesday', () => {
    const now = Date.now();
    const cadences = crewCadences({
      '2026-09-14': { state: 'pending', startAt: ts(now + 2 * HOUR), startTime: '05:00', lastAskedAt: ts(now - 20 * HOUR) },
      '2026-09-15': { state: 'pending', startAt: ts(now + 26 * HOUR), startTime: '05:00', lastAskedAt: ts(now - 10 * 60 * 1000) },
      '2026-09-16': { state: 'pending', startAt: ts(now + 50 * HOUR), startTime: '05:00' },
    });
    expect(pickPendingCadence(cadences)?.workDate).toBe('2026-09-15');
  });

  test("Monday's YES never confirms Tuesday — each day keeps its own state", () => {
    const now = Date.now();
    const cadences = crewCadences({
      '2026-09-14': { state: 'confirmed', startAt: ts(now + 2 * HOUR), startTime: '05:00', lastAskedAt: ts(now - 5 * 60 * 1000) },
      '2026-09-15': { state: 'pending', startAt: ts(now + 26 * HOUR), startTime: '05:00', lastAskedAt: ts(now - 60 * 60 * 1000) },
    });
    expect(cadences.map((c) => [c.workDate, c.state])).toEqual([
      ['2026-09-14', 'confirmed'],
      ['2026-09-15', 'pending'],
    ]);
    expect(pickPendingCadence(cadences)?.workDate).toBe('2026-09-15');
  });

  test('a day that already started is not a pending candidate', () => {
    const now = Date.now();
    const cadences = crewCadences({
      '2026-09-14': { state: 'pending', startAt: ts(now - HOUR), startTime: '05:00', lastAskedAt: ts(now - 2 * 60 * 1000) },
    });
    expect(cadences).toHaveLength(1);
    expect(pickPendingCadence(cadences)).toBeNull();
  });
});
