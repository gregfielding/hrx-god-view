/**
 * Regression tests for the reply-routing bug found 2026-08-31.
 *
 * Kelly Idarraga held two pending Usher shifts on 2026-08-30 (1:00 PM and
 * 6:00 PM, different job orders). Every "Si" she sent was bound to the
 * EARLIEST pending shift, so the 6:00 PM shift's escalation ladder was never
 * cancelled: it kept asking, she kept replying, and she received 12 messages
 * in a rolling day — including a "last reminder, we may reassign your shift"
 * 23 minutes after she had confirmed.
 *
 * The fix routes a reply to the shift we most recently ASKED about.
 */

import {
  compareByAskThenStart,
  pickPendingCadence,
  shiftWhenLabel,
  type ActiveCadence,
} from '../cadenceReplyHandler';

const HOUR = 60 * 60 * 1000;

function cadence(over: Partial<ActiveCadence> & { assignmentId: string }): ActiveCadence {
  return {
    tenantId: 'T',
    assignment: {},
    startMs: Date.now() + 24 * HOUR,
    state: 'pending',
    lastAskedAtMs: 0,
    ...over,
  };
}

describe('reply routing — which shift is this "YES" about?', () => {
  it('routes to the most recently asked shift, not the earliest one', () => {
    const now = Date.now();
    // Mirrors Kelly: 1 PM shift starts sooner, but the 6 PM shift is the one
    // we just texted her about.
    const early = cadence({
      assignmentId: 'shift_1pm',
      startMs: now + 5 * HOUR,
      lastAskedAtMs: now - 12 * HOUR,
    });
    const asked = cadence({
      assignmentId: 'shift_6pm',
      startMs: now + 10 * HOUR,
      lastAskedAtMs: now - 20 * 60 * 1000, // asked 20 minutes ago
    });

    expect(pickPendingCadence([early, asked])?.assignmentId).toBe('shift_6pm');
    // Order of the input array must not matter.
    expect(pickPendingCadence([asked, early])?.assignmentId).toBe('shift_6pm');
  });

  it('falls back to earliest start when neither shift has been asked about', () => {
    const now = Date.now();
    const early = cadence({ assignmentId: 'early', startMs: now + 5 * HOUR });
    const late = cadence({ assignmentId: 'late', startMs: now + 10 * HOUR });

    expect(pickPendingCadence([late, early])?.assignmentId).toBe('early');
  });

  it('falls back to earliest start when both were asked at the same instant', () => {
    const now = Date.now();
    const early = cadence({ assignmentId: 'early', startMs: now + 5 * HOUR, lastAskedAtMs: now - HOUR });
    const late = cadence({ assignmentId: 'late', startMs: now + 10 * HOUR, lastAskedAtMs: now - HOUR });

    expect(pickPendingCadence([late, early])?.assignmentId).toBe('early');
  });

  it('ignores shifts that already started and shifts that are not pending', () => {
    const now = Date.now();
    const past = cadence({ assignmentId: 'past', startMs: now - HOUR, lastAskedAtMs: now });
    const confirmed = cadence({ assignmentId: 'confirmed', state: 'confirmed', lastAskedAtMs: now });
    const valid = cadence({ assignmentId: 'valid', startMs: now + 3 * HOUR });

    expect(pickPendingCadence([past, confirmed, valid])?.assignmentId).toBe('valid');
    expect(pickPendingCadence([past, confirmed])).toBeNull();
  });

  it('sorts a full set newest-asked first, then by start', () => {
    const now = Date.now();
    const a = cadence({ assignmentId: 'a', startMs: now + 9 * HOUR, lastAskedAtMs: now - HOUR });
    const b = cadence({ assignmentId: 'b', startMs: now + 2 * HOUR, lastAskedAtMs: 0 });
    const c = cadence({ assignmentId: 'c', startMs: now + 8 * HOUR, lastAskedAtMs: now - 60_000 });

    expect([a, b, c].sort(compareByAskThenStart).map((x) => x.assignmentId)).toEqual(['c', 'a', 'b']);
  });
});

describe('shiftWhenLabel — naming the shift in a receipt', () => {
  it('renders date and 12-hour time in English', () => {
    expect(shiftWhenLabel({ startDate: '2026-08-30', startTime: '18:00' }, false)).toBe('Aug 30, 6:00 PM');
  });

  it('renders date and time in Spanish day-first order', () => {
    expect(shiftWhenLabel({ startDate: '2026-08-30', startTime: '18:00' }, true)).toBe('30 ago, 6:00 PM');
  });

  it('handles midnight and noon without rendering 0:00', () => {
    expect(shiftWhenLabel({ startDate: '2026-01-05', startTime: '00:30' }, false)).toBe('Jan 5, 12:30 AM');
    expect(shiftWhenLabel({ startDate: '2026-01-05', startTime: '12:00' }, false)).toBe('Jan 5, 12:00 PM');
  });

  it('degrades to date-only when the time is missing or malformed', () => {
    expect(shiftWhenLabel({ startDate: '2026-08-30' }, false)).toBe('Aug 30');
    expect(shiftWhenLabel({ startDate: '2026-08-30', startTime: 'evening' }, false)).toBe('Aug 30');
    expect(shiftWhenLabel({ startDate: '2026-08-30', startTime: '99:99' }, false)).toBe('Aug 30');
  });

  it('returns empty string when there is no usable date, so callers omit the label', () => {
    expect(shiftWhenLabel({}, false)).toBe('');
    expect(shiftWhenLabel({ startDate: 'next Tuesday' }, false)).toBe('');
    expect(shiftWhenLabel({ startDate: '2026-13-01' }, false)).toBe('');
  });
});
