/**
 * **R.2** — Unit tests for `matchPhysicalWillingness` (and the
 * willingness-mapping primitives it shares with the other three
 * willingness matchers).
 *
 * Behaviour scope: input → status mapping per D8.R2. The matcher's gate
 * (whether the JO has a `physicalRequirements` field populated) is the
 * helper's responsibility; this test only covers the value mapping.
 *
 * @see shared/jobRequirementMatchers/matchPhysicalWillingness.ts
 * @see docs/READINESS_R1_R2_HANDOFF.md §D8.R2
 */

import { matchPhysicalWillingness } from '../jobRequirementMatchers/matchPhysicalWillingness';
import {
  normalizeWillingness,
  willingnessToStatus,
  worseOfWillingness,
} from '../jobRequirementMatchers/willingness';

describe('matchPhysicalWillingness — D8.R2 status mapping', () => {
  it("maps 'yes' → complete_pass", () => {
    const r = matchPhysicalWillingness({ willingness: 'yes' });
    expect(r.status).toBe('complete_pass');
    expect(r.reason).toBe('physical_willingness_yes');
    expect(r.details?.willingness).toBe('yes');
  });

  it("maps 'maybe' → needs_review", () => {
    const r = matchPhysicalWillingness({ willingness: 'maybe' });
    expect(r.status).toBe('needs_review');
    expect(r.reason).toBe('physical_willingness_maybe');
  });

  it("maps 'no' → complete_fail", () => {
    const r = matchPhysicalWillingness({ willingness: 'no' });
    expect(r.status).toBe('complete_fail');
    expect(r.reason).toBe('physical_willingness_no');
  });

  it.each([null, undefined, '', '   ', 'unknown', 'YES?'])(
    'maps not-picked sentinel %p → incomplete',
    (value) => {
      const r = matchPhysicalWillingness({ willingness: value as never });
      expect(r.status).toBe('incomplete');
      expect(r.reason).toBe('physical_willingness_not_picked');
      expect(r.details?.willingness).toBeNull();
    },
  );

  it("trims trailing whitespace ('yes ' → complete_pass)", () => {
    // `normalizeWillingness` trims + lowercases; this is intentional so
    // form-field artifacts don't degrade a real answer to `'incomplete'`.
    const r = matchPhysicalWillingness({ willingness: 'yes ' as never });
    expect(r.status).toBe('complete_pass');
  });
});

describe('matchPhysicalWillingness — Title-Case tolerance (apply UX writes Title-Case)', () => {
  // The wizard persists `'Yes' | 'No' | 'Maybe'` to `comfortableWith*`; the
  // R.0 sync trigger copies those values verbatim into `workerAttestations.*`
  // without lowercasing. The matcher therefore must accept both casings.
  it.each<[string, 'complete_pass' | 'complete_fail' | 'needs_review']>([
    ['Yes', 'complete_pass'],
    ['YES', 'complete_pass'],
    ['No', 'complete_fail'],
    ['NO', 'complete_fail'],
    ['Maybe', 'needs_review'],
    [' maybe ', 'needs_review'],
  ])('Title-Case %p → %p', (input, expected) => {
    expect(matchPhysicalWillingness({ willingness: input }).status).toBe(expected);
  });
});

describe('willingness — normalizeWillingness primitive', () => {
  it('lowercases + trims recognized values', () => {
    expect(normalizeWillingness('Yes')).toBe('yes');
    expect(normalizeWillingness('  MAYBE ')).toBe('maybe');
    expect(normalizeWillingness('no')).toBe('no');
  });
  it('collapses unknown / empty / null to null', () => {
    expect(normalizeWillingness('')).toBeNull();
    expect(normalizeWillingness('unknown')).toBeNull();
    expect(normalizeWillingness(null)).toBeNull();
    expect(normalizeWillingness(undefined)).toBeNull();
    expect(normalizeWillingness(42 as never)).toBeNull();
  });
});

describe('willingness — willingnessToStatus primitive', () => {
  it('hits all D8.R2 mappings', () => {
    expect(willingnessToStatus('yes')).toBe('complete_pass');
    expect(willingnessToStatus('maybe')).toBe('needs_review');
    expect(willingnessToStatus('no')).toBe('complete_fail');
    expect(willingnessToStatus(null)).toBe('incomplete');
  });
});

describe('willingness — worseOfWillingness primitive', () => {
  it('null + null → null', () => {
    expect(worseOfWillingness(null, null)).toBeNull();
  });
  it('null yields to whichever side has an answer', () => {
    expect(worseOfWillingness('yes', null)).toBe('yes');
    expect(worseOfWillingness(null, 'no')).toBe('no');
    expect(worseOfWillingness(null, 'maybe')).toBe('maybe');
  });
  it('no < maybe < yes — worst wins', () => {
    expect(worseOfWillingness('yes', 'no')).toBe('no');
    expect(worseOfWillingness('no', 'yes')).toBe('no');
    expect(worseOfWillingness('yes', 'maybe')).toBe('maybe');
    expect(worseOfWillingness('maybe', 'yes')).toBe('maybe');
    expect(worseOfWillingness('no', 'maybe')).toBe('no');
    expect(worseOfWillingness('maybe', 'no')).toBe('no');
  });
  it('equal answers stay stable', () => {
    expect(worseOfWillingness('yes', 'yes')).toBe('yes');
    expect(worseOfWillingness('maybe', 'maybe')).toBe('maybe');
    expect(worseOfWillingness('no', 'no')).toBe('no');
  });
});
