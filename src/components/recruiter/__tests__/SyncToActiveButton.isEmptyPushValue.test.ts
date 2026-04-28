/**
 * R.16.2c hotfix — `isEmptyPushValue` guard.
 *
 * Locks in the empty-detection semantics that gate the
 * `SyncToActiveButton` confirm dialog. Trade-offs:
 *   - `0` and `false` are NOT empty (legitimate values for numeric
 *     and boolean fields like `eVerifyRequired` / `markupPercentage`).
 *   - Whitespace-only strings ARE empty (operators paste a stray
 *     space; that should still trip the guard).
 *   - Empty objects are NOT treated as empty (no field shape uses
 *     plain `{}` as a "cleared" state today; revisit if `scheduler`
 *     ever exposes a `{}` cleared form).
 */

import { isEmptyPushValue } from '../SyncToActiveButton';

describe('isEmptyPushValue (R.16.2c hotfix)', () => {
  it('treats null/undefined as empty', () => {
    expect(isEmptyPushValue(null)).toBe(true);
    expect(isEmptyPushValue(undefined)).toBe(true);
  });

  it('treats empty/whitespace-only strings as empty', () => {
    expect(isEmptyPushValue('')).toBe(true);
    expect(isEmptyPushValue('   ')).toBe(true);
    expect(isEmptyPushValue('\n\t  ')).toBe(true);
  });

  it('treats empty arrays as empty', () => {
    expect(isEmptyPushValue([])).toBe(true);
  });

  it('does NOT treat non-empty strings as empty', () => {
    expect(isEmptyPushValue('hello')).toBe(false);
    expect(isEmptyPushValue('0')).toBe(false);
  });

  it('does NOT treat non-empty arrays as empty', () => {
    expect(isEmptyPushValue(['a'])).toBe(false);
    expect(isEmptyPushValue([0])).toBe(false);
  });

  it('does NOT treat 0 as empty (legitimate numeric value)', () => {
    expect(isEmptyPushValue(0)).toBe(false);
  });

  it('does NOT treat false as empty (legitimate boolean value, e.g. eVerifyRequired)', () => {
    expect(isEmptyPushValue(false)).toBe(false);
  });

  it('does NOT treat plain objects as empty', () => {
    expect(isEmptyPushValue({})).toBe(false);
    expect(isEmptyPushValue({ scheduler: 'someone' })).toBe(false);
  });
});
