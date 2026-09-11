/**
 * Regression tests for "NO" replies after the T+15 late check-in (2026-09-11).
 *
 * The late check-in is the first cadence text sent AFTER start that invites a
 * NO ("…or NO if you can't make it"). The cancel lookup only considered future
 * shifts, so that NO skipped the shift it answered and cancelled the worker's
 * NEXT one: for a CORT Woodridge crew member, a 5:20 AM Monday NO would have
 * cancelled Tuesday. A started shift is now cancellable when we asked about it
 * after it started, and ask recency still picks between it and a later ask.
 */

import { pickCancellableCadence, type ActiveCadence } from '../cadenceReplyHandler';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function day(over: Partial<ActiveCadence> & { workDate: string }): ActiveCadence {
  return {
    tenantId: 'T',
    assignmentId: 'woodridge_crew_member',
    assignment: {},
    startMs: Date.now() + 24 * HOUR,
    state: 'confirmed',
    lastAskedAtMs: 0,
    ...over,
  };
}

describe('reply routing — which shift is this "NO" about?', () => {
  it('binds a NO sent after the late check-in to today, not tomorrow', () => {
    const todayStart = Date.now() - 20 * MIN;
    const today = day({ workDate: '2026-09-14', startMs: todayStart, lastAskedAtMs: todayStart + 15 * MIN });
    const tomorrow = day({ workDate: '2026-09-15', startMs: todayStart + 24 * HOUR, state: 'pending' });

    expect(pickCancellableCadence([tomorrow, today])?.workDate).toBe('2026-09-14');
  });

  it("binds to tomorrow once tomorrow's ask went out more recently", () => {
    const now = Date.now();
    const todayStart = now - 3 * HOUR;
    const today = day({ workDate: '2026-09-14', startMs: todayStart, lastAskedAtMs: todayStart + 15 * MIN });
    const tomorrow = day({
      workDate: '2026-09-15',
      startMs: todayStart + 24 * HOUR,
      state: 'pending',
      lastAskedAtMs: now - 5 * MIN,
    });

    expect(pickCancellableCadence([today, tomorrow])?.workDate).toBe('2026-09-15');
  });

  it('never cancels a started shift that was only asked about before it started', () => {
    const todayStart = Date.now() - 20 * MIN;
    const today = day({ workDate: '2026-09-14', startMs: todayStart, lastAskedAtMs: todayStart - 12 * HOUR });
    const tomorrow = day({ workDate: '2026-09-15', startMs: todayStart + 24 * HOUR });

    expect(pickCancellableCadence([today, tomorrow])?.workDate).toBe('2026-09-15');
    expect(pickCancellableCadence([today])).toBeNull();
  });

  it('lets the post-start ask lapse after 6 hours', () => {
    const start = Date.now() - 7 * HOUR;
    expect(pickCancellableCadence([day({ workDate: '2026-09-14', startMs: start, lastAskedAtMs: start + 15 * MIN })])).toBeNull();
  });

  it('ignores a started day that is already resolved', () => {
    const start = Date.now() - 20 * MIN;
    for (const state of ['checked_in', 'cancelled', 'no_show']) {
      expect(
        pickCancellableCadence([day({ workDate: '2026-09-14', startMs: start, lastAskedAtMs: start + 15 * MIN, state })]),
      ).toBeNull();
    }
  });

  it('still matches confirmed future shifts (the 2026-08-29 behavior)', () => {
    const future = day({ workDate: '2026-09-15', state: 'confirmed' });
    expect(pickCancellableCadence([future])?.workDate).toBe('2026-09-15');
  });
});
