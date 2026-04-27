/**
 * **R.2** — Unit tests for `matchUniformWillingness`. The library +
 * custom worse-of combination is the only behavioural complexity in the
 * willingness family; the standard D8.R2 mapping is shared with the other
 * three matchers and exhaustively covered in
 * `matchPhysicalWillingness.test.ts`.
 *
 * @see shared/jobRequirementMatchers/matchUniformWillingness.ts
 * @see shared/jobRequirementMatchers/willingness.ts (worseOfWillingness)
 */

import { matchUniformWillingness } from '../jobRequirementMatchers/matchUniformWillingness';

describe('matchUniformWillingness — D8.R2 single-gate mapping', () => {
  it('library only — yes → complete_pass', () => {
    const r = matchUniformWillingness({
      jobHasLibraryUniform: true,
      jobHasCustomUniform: false,
      libraryWillingness: 'yes',
      customWillingness: 'no',
    });
    expect(r.status).toBe('complete_pass');
    // `customWillingness: 'no'` ignored because the JO doesn't gate on it.
    expect(r.details?.customWillingness).toBeNull();
    expect(r.details?.libraryWillingness).toBe('yes');
    expect(r.details?.effectiveWillingness).toBe('yes');
  });

  it('custom only — no → complete_fail (library answer ignored)', () => {
    const r = matchUniformWillingness({
      jobHasLibraryUniform: false,
      jobHasCustomUniform: true,
      libraryWillingness: 'yes',
      customWillingness: 'no',
    });
    expect(r.status).toBe('complete_fail');
    expect(r.details?.libraryWillingness).toBeNull();
    expect(r.details?.customWillingness).toBe('no');
  });

  it('neither gate active → not_applicable (defensive)', () => {
    const r = matchUniformWillingness({
      jobHasLibraryUniform: false,
      jobHasCustomUniform: false,
      libraryWillingness: 'yes',
      customWillingness: 'yes',
    });
    expect(r.status).toBe('not_applicable');
    expect(r.reason).toBe('uniform_willingness_no_active_gate');
  });
});

describe('matchUniformWillingness — worse-of when both gates active', () => {
  // The matcher must take the WORST of the two answers (no < maybe < yes),
  // with `null` (not picked) yielding to whatever the other side answered.
  it.each<[string, string, string]>([
    ['yes', 'yes', 'complete_pass'],
    ['yes', 'maybe', 'needs_review'],
    ['yes', 'no', 'complete_fail'],
    ['maybe', 'no', 'complete_fail'],
    ['no', 'no', 'complete_fail'],
    ['maybe', 'maybe', 'needs_review'],
    // null yields:
    ['yes', '', 'complete_pass'], // '' normalizes to null
    ['', 'yes', 'complete_pass'],
    ['no', '', 'complete_fail'],
    // both null:
    ['', '', 'incomplete'],
  ])('library=%p + custom=%p → %p', (lib, cust, expected) => {
    const r = matchUniformWillingness({
      jobHasLibraryUniform: true,
      jobHasCustomUniform: true,
      libraryWillingness: lib as never,
      customWillingness: cust as never,
    });
    expect(r.status).toBe(expected);
  });

  it('Title-Case answers also worse-of correctly', () => {
    const r = matchUniformWillingness({
      jobHasLibraryUniform: true,
      jobHasCustomUniform: true,
      libraryWillingness: 'Yes',
      customWillingness: 'No',
    });
    expect(r.status).toBe('complete_fail');
    expect(r.details?.libraryWillingness).toBe('yes');
    expect(r.details?.customWillingness).toBe('no');
    expect(r.details?.effectiveWillingness).toBe('no');
  });
});
