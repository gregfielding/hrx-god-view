/**
 * Tests for the inline-edit validators on `TimesheetEntryV2`.
 *
 * Coverage shape:
 *   - validateActualTime: empty allowed, parsing reuses timeFormat
 *   - validateActualsPair: zero-duration rejected, overnight allowed
 *   - validateTips / validateBonusAmount: non-negative, two-decimal round
 *   - validateNotes: 1000-char cap
 *   - validateBreak: inverted / parse-fail rejected
 *   - validateBreakAgainstShift: outside-shift rejected, overnight blocked
 */

import {
  isValidationFail,
  validateActualTime,
  validateActualsPair,
  validateBonusAmount,
  validateBreak,
  validateBreakAgainstShift,
  validateNotes,
  validateTips,
} from '../entryValidation';

describe('validateActualTime', () => {
  test('empty / null / undefined → null (clearing actuals is allowed)', () => {
    expect(validateActualTime('')).toEqual({ ok: true, value: null });
    expect(validateActualTime(null)).toEqual({ ok: true, value: null });
    expect(validateActualTime(undefined)).toEqual({ ok: true, value: null });
    expect(validateActualTime('   ')).toEqual({ ok: true, value: null });
  });

  test.each([
    ['8', '08:00'],
    ['8:30', '08:30'],
    ['8a', '08:00'],
    ['1230', '12:30'],
    ['11:59 PM', '23:59'],
  ])('canonicalizes %s → %s', (input, expected) => {
    const r = validateActualTime(input);
    expect(r).toEqual({ ok: true, value: expected });
  });

  test('rejects malformed with parse-failure reason', () => {
    const r = validateActualTime('abc');
    expect(r.ok).toBe(false);
  });

  test('rejects out-of-range hours', () => {
    const r = validateActualTime('25:00');
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('hours_out_of_range');
  });
});

describe('validateActualsPair', () => {
  test('both null → ok', () => {
    expect(validateActualsPair(null, null)).toEqual({
      ok: true,
      value: { start: null, end: null },
    });
  });

  test('start set, end null → ok (in-progress shift)', () => {
    expect(validateActualsPair('08:00', null)).toEqual({
      ok: true,
      value: { start: '08:00', end: null },
    });
  });

  test('start null, end set → ok (rare but legal)', () => {
    expect(validateActualsPair(null, '17:00')).toEqual({
      ok: true,
      value: { start: null, end: '17:00' },
    });
  });

  test('end > start → ok', () => {
    expect(validateActualsPair('08:00', '17:00')).toEqual({
      ok: true,
      value: { start: '08:00', end: '17:00' },
    });
  });

  test('end < start → ok (overnight, treated as next-day by engine)', () => {
    expect(validateActualsPair('22:00', '06:00')).toEqual({
      ok: true,
      value: { start: '22:00', end: '06:00' },
    });
  });

  test('end === start → zero_duration fail', () => {
    const r = validateActualsPair('08:00', '08:00');
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('zero_duration');
  });

  test('propagates parse failures', () => {
    expect(validateActualsPair('garbage', '17:00').ok).toBe(false);
    expect(validateActualsPair('08:00', 'garbage').ok).toBe(false);
  });
});

describe('validateTips / validateBonusAmount', () => {
  test.each([
    [null, 0],
    [undefined, 0],
    ['', 0],
    ['12.50', 12.5],
    ['  12.5  ', 12.5],
    [12.345, 12.35], // rounds up
    [12.344, 12.34], // rounds down
    ['0', 0],
    [0, 0],
    [500, 500],
  ])('validateTips(%p) → %p', (input, expected) => {
    expect(validateTips(input)).toEqual({ ok: true, value: expected });
  });

  test.each(['-1', '-0.01', 'abc', NaN, Infinity, -Infinity, -5])(
    'validateTips(%p) → fail',
    (input) => {
      expect(validateTips(input as never).ok).toBe(false);
    },
  );

  test('validateBonusAmount uses bonus-specific copy on failure', () => {
    const r = validateBonusAmount('-1');
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.message).toMatch(/Bonus/);
  });
});

describe('validateNotes', () => {
  test('empty / null / undefined → ""', () => {
    expect(validateNotes(null)).toEqual({ ok: true, value: '' });
    expect(validateNotes(undefined)).toEqual({ ok: true, value: '' });
    expect(validateNotes('')).toEqual({ ok: true, value: '' });
  });

  test('passthrough for normal text', () => {
    expect(validateNotes('Worker came in 30 min late')).toEqual({
      ok: true,
      value: 'Worker came in 30 min late',
    });
  });

  test('rejects > 1000 chars with character count in message', () => {
    const long = 'x'.repeat(1001);
    const r = validateNotes(long);
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) {
      expect(r.reason).toBe('too_long');
      expect(r.message).toMatch(/1000/);
      expect(r.message).toMatch(/1001/);
    }
  });
});

describe('validateBreak', () => {
  test('valid 30-min lunch', () => {
    const r = validateBreak({ startTime: '12:00', endTime: '12:30', paid: false });
    expect(r).toEqual({
      ok: true,
      value: {
        startTime: '12:00',
        endTime: '12:30',
        durationMins: 30,
        paid: false,
      },
    });
  });

  test('canonicalizes shorthand input', () => {
    const r = validateBreak({ startTime: '12p', endTime: '12:30p' });
    expect(r).toEqual({
      ok: true,
      value: {
        startTime: '12:00',
        endTime: '12:30',
        durationMins: 30,
        paid: false,
      },
    });
  });

  test('inverted (end ≤ start) → fail', () => {
    const r = validateBreak({ startTime: '12:30', endTime: '12:00' });
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('inverted');
  });

  test('zero-duration → fail', () => {
    const r = validateBreak({ startTime: '12:00', endTime: '12:00' });
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('inverted');
  });

  test('malformed start surfaces parse reason with start_ prefix', () => {
    const r = validateBreak({ startTime: 'garbage', endTime: '12:30' });
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toMatch(/^start_/);
  });

  test('malformed end surfaces parse reason with end_ prefix', () => {
    const r = validateBreak({ startTime: '12:00', endTime: 'garbage' });
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toMatch(/^end_/);
  });
});

describe('validateBreakAgainstShift', () => {
  test('break inside shift window → ok', () => {
    const r = validateBreakAgainstShift(
      { startTime: '12:00', endTime: '12:30' },
      '08:00',
      '17:00',
    );
    expect(r.ok).toBe(true);
  });

  test('break starts before shift → outside_shift', () => {
    const r = validateBreakAgainstShift(
      { startTime: '07:30', endTime: '08:30' },
      '08:00',
      '17:00',
    );
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('outside_shift');
  });

  test('break ends after shift → outside_shift', () => {
    const r = validateBreakAgainstShift(
      { startTime: '16:30', endTime: '17:30' },
      '08:00',
      '17:00',
    );
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('outside_shift');
  });

  test('overnight shift → overnight_unsupported (P3.A scope cut)', () => {
    const r = validateBreakAgainstShift(
      { startTime: '02:00', endTime: '02:30' },
      '22:00',
      '06:00',
    );
    expect(isValidationFail(r)).toBe(true);
    if (isValidationFail(r)) expect(r.reason).toBe('overnight_unsupported');
  });

  test('shift window unset → break accepted as-is', () => {
    const r = validateBreakAgainstShift(
      { startTime: '12:00', endTime: '12:30' },
      null,
      null,
    );
    expect(r.ok).toBe(true);
  });

  test('break exactly at shift start/end → ok (boundary case)', () => {
    const r = validateBreakAgainstShift(
      { startTime: '08:00', endTime: '17:00' },
      '08:00',
      '17:00',
    );
    expect(r.ok).toBe(true);
  });

  test('parse failure inside break propagates', () => {
    const r = validateBreakAgainstShift(
      { startTime: 'garbage', endTime: '12:30' },
      '08:00',
      '17:00',
    );
    expect(r.ok).toBe(false);
  });
});
