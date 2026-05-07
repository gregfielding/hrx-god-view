/**
 * Tests for `parseTimeInput` and friends — the single source of
 * truth for client-side time parsing in the recruiter timesheet grid.
 *
 * Coverage matrix:
 *   - canonical HH:mm round-trips
 *   - shorthand digit forms (1/2/3/4 digits)
 *   - meridiem handling (12am=0, 12pm=12, 1pm=13, 12:30am=00:30)
 *   - rejection of malformed / out-of-range / empty inputs
 *   - failure-reason taxonomy (each branch reports the right enum)
 *   - display + minutes round-trip helpers
 */

import {
  formatTime24,
  formatTimeForDisplay,
  minutesToTime,
  parseTimeInput,
  timeParseFailureMessage,
  timeToMinutes,
} from '../timeFormat';

describe('parseTimeInput — happy paths', () => {
  test.each([
    ['8', '08:00', 8 * 60],
    ['08', '08:00', 8 * 60],
    ['00', '00:00', 0],
    ['23', '23:00', 23 * 60],
    ['8:00', '08:00', 8 * 60],
    ['08:00', '08:00', 8 * 60],
    ['8:30', '08:30', 8 * 60 + 30],
    ['23:59', '23:59', 23 * 60 + 59],
    ['830', '08:30', 8 * 60 + 30],
    ['0830', '08:30', 8 * 60 + 30],
    ['1230', '12:30', 12 * 60 + 30],
    ['1730', '17:30', 17 * 60 + 30],
  ])('parses %s → %s (%i mins)', (input, expectedValue, expectedMinutes) => {
    const r = parseTimeInput(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(expectedValue);
      expect(r.minutes).toBe(expectedMinutes);
    }
  });

  test.each([
    ['8a', '08:00', 8 * 60],
    ['8 am', '08:00', 8 * 60],
    ['8:00 AM', '08:00', 8 * 60],
    ['12a', '00:00', 0],
    ['12am', '00:00', 0],
    ['12:30am', '00:30', 30],
    ['12p', '12:00', 12 * 60],
    ['12pm', '12:00', 12 * 60],
    ['12:30pm', '12:30', 12 * 60 + 30],
    ['1p', '13:00', 13 * 60],
    ['1:30p', '13:30', 13 * 60 + 30],
    ['11pm', '23:00', 23 * 60],
    ['11:59 PM', '23:59', 23 * 60 + 59],
  ])('parses meridiem %s → %s', (input, expectedValue, expectedMinutes) => {
    const r = parseTimeInput(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(expectedValue);
      expect(r.minutes).toBe(expectedMinutes);
    }
  });

  test('strips surrounding whitespace', () => {
    const r = parseTimeInput('  8:00  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('08:00');
  });
});

describe('parseTimeInput — rejection paths with reason taxonomy', () => {
  test.each([
    [null, 'empty'],
    [undefined, 'empty'],
    ['', 'empty'],
    ['   ', 'empty'],
  ])('rejects %p as empty', (input, reason) => {
    const r = parseTimeInput(input);
    expect(r).toEqual({ ok: false, reason });
  });

  test.each([
    'morning',
    '8a3',
    '8:0:0',
    '8.30',
    '8 30',
    '12345',
    '8:3', // single-digit minutes — ambiguous, reject
    '-8:00',
    '8:60', // 60 minutes
    'abc',
    'p',
    'am',
  ])('rejects %p as malformed', (input) => {
    const r = parseTimeInput(input);
    expect(r.ok).toBe(false);
  });

  test('rejects 24:00 as out of range (no overnight in wire format)', () => {
    const r = parseTimeInput('24:00');
    expect(r).toEqual({ ok: false, reason: 'hours_out_of_range' });
  });

  test('rejects 25:30 as out of range', () => {
    const r = parseTimeInput('25:30');
    expect(r).toEqual({ ok: false, reason: 'hours_out_of_range' });
  });

  test('rejects 8:75 as minutes_out_of_range', () => {
    const r = parseTimeInput('8:75');
    expect(r).toEqual({ ok: false, reason: 'minutes_out_of_range' });
  });

  test('rejects 13pm (h>12 with meridiem)', () => {
    const r = parseTimeInput('13pm');
    expect(r).toEqual({ ok: false, reason: 'hours_out_of_range' });
  });

  test('rejects 0am (h<1 with meridiem)', () => {
    const r = parseTimeInput('0am');
    expect(r).toEqual({ ok: false, reason: 'hours_out_of_range' });
  });
});

describe('timeParseFailureMessage', () => {
  test('every taxonomy enum has a message', () => {
    expect(timeParseFailureMessage('empty')).toMatch(/Enter a time/);
    expect(timeParseFailureMessage('malformed')).toMatch(/HH:mm/);
    expect(timeParseFailureMessage('hours_out_of_range')).toMatch(/Hour/);
    expect(timeParseFailureMessage('minutes_out_of_range')).toMatch(/Minutes/);
  });
});

describe('formatTime24', () => {
  test('zero-pads single-digit hours and minutes', () => {
    expect(formatTime24(8, 0)).toBe('08:00');
    expect(formatTime24(0, 0)).toBe('00:00');
    expect(formatTime24(9, 5)).toBe('09:05');
  });

  test('clamps out-of-range inputs (defensive)', () => {
    expect(formatTime24(-1, 0)).toBe('00:00');
    expect(formatTime24(24, 0)).toBe('23:00');
    expect(formatTime24(8, 60)).toBe('08:59');
    expect(formatTime24(8, -5)).toBe('08:00');
  });

  test('floors fractional inputs', () => {
    expect(formatTime24(8.7, 30.9)).toBe('08:30');
  });
});

describe('formatTimeForDisplay', () => {
  test('em-dash on null/undefined/empty', () => {
    expect(formatTimeForDisplay(null)).toBe('—');
    expect(formatTimeForDisplay(undefined)).toBe('—');
    expect(formatTimeForDisplay('')).toBe('—');
    expect(formatTimeForDisplay('   ')).toBe('—');
  });

  test('normalizes 1-digit hour values', () => {
    expect(formatTimeForDisplay('8:00')).toBe('08:00');
    expect(formatTimeForDisplay('9:5')).toBe('9:5'); // unparseable → as-is
  });

  test('passthrough for already-canonical values', () => {
    expect(formatTimeForDisplay('08:00')).toBe('08:00');
    expect(formatTimeForDisplay('17:30')).toBe('17:30');
  });
});

describe('timeToMinutes / minutesToTime round-trip', () => {
  test.each([
    ['00:00', 0],
    ['08:30', 8 * 60 + 30],
    ['12:00', 12 * 60],
    ['23:59', 23 * 60 + 59],
  ])('%s ⇄ %i minutes', (str, mins) => {
    expect(timeToMinutes(str)).toBe(mins);
    expect(minutesToTime(mins)).toBe(str);
  });

  test('timeToMinutes returns null on malformed', () => {
    expect(timeToMinutes('garbage')).toBeNull();
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
  });

  test('minutesToTime wraps cleanly across midnight', () => {
    expect(minutesToTime(24 * 60)).toBe('00:00');
    expect(minutesToTime(25 * 60)).toBe('01:00');
    expect(minutesToTime(-30)).toBe('23:30');
  });
});
