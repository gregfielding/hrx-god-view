/**
 * R.16.2c hotfix — empty-array / empty-string fallthrough.
 *
 * Locks in the new merge semantics so a child account's empty
 * multi-select / blank text override doesn't suppress the parent
 * account's value (the "child looks empty even though parent has
 * values" bug — see the hotfix doc on `mergeRecruiterOrderDetails`).
 */

import {
  mergeRecruiterOrderDetails,
  type RecruiterOrderDetailsData,
} from '../recruiterAccountOrderDefaultsMerge';

const PARENT_ARRAY = ['Walking', 'Sitting', 'Lifting 50 lbs'];
const PARENT_TEXT = 'Dress Code: Plain shirt with jeans';

describe('mergeRecruiterOrderDetails — empty-array fallthrough (R.16.2c hotfix)', () => {
  it('falls through to parent when child explicitly stores empty array', () => {
    const child: RecruiterOrderDetailsData = { physicalRequirements: [] };
    const parent: RecruiterOrderDetailsData = { physicalRequirements: PARENT_ARRAY };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.physicalRequirements).toEqual(PARENT_ARRAY);
  });

  it('falls through to parent when child has undefined array', () => {
    const child: RecruiterOrderDetailsData = {};
    const parent: RecruiterOrderDetailsData = { physicalRequirements: PARENT_ARRAY };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.physicalRequirements).toEqual(PARENT_ARRAY);
  });

  it('uses child value when child has a non-empty array', () => {
    const child: RecruiterOrderDetailsData = { physicalRequirements: ['Indoor Work'] };
    const parent: RecruiterOrderDetailsData = { physicalRequirements: PARENT_ARRAY };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.physicalRequirements).toEqual(['Indoor Work']);
  });

  it('returns empty array when both child and parent are empty', () => {
    const child: RecruiterOrderDetailsData = { physicalRequirements: [] };
    const parent: RecruiterOrderDetailsData = { physicalRequirements: [] };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.physicalRequirements).toEqual([]);
  });

  it('returns empty array when both child and parent are undefined', () => {
    const result = mergeRecruiterOrderDetails(undefined, undefined);
    expect(result.physicalRequirements).toEqual([]);
  });

  it('applies the same fallthrough to additionalScreenings', () => {
    const child: RecruiterOrderDetailsData = { additionalScreenings: [] };
    const parent: RecruiterOrderDetailsData = { additionalScreenings: ['mvr'] };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.additionalScreenings).toEqual(['mvr']);
  });

  it('applies the same fallthrough to dressCode', () => {
    const child: RecruiterOrderDetailsData = { dressCode: [] };
    const parent: RecruiterOrderDetailsData = { dressCode: ['business-casual'] };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.dressCode).toEqual(['business-casual']);
  });

  it('applies the same fallthrough to backgroundCheckPackages', () => {
    const child: RecruiterOrderDetailsData = { backgroundCheckPackages: [] };
    const parent: RecruiterOrderDetailsData = { backgroundCheckPackages: ['standard'] };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.backgroundCheckPackages).toEqual(['standard']);
  });

  it('preserves child value when location layer overrides via the second merge call', () => {
    const child: RecruiterOrderDetailsData = { physicalRequirements: ['Outdoor Work'] };
    const parent: RecruiterOrderDetailsData = { physicalRequirements: PARENT_ARRAY };
    const childPlusParent = mergeRecruiterOrderDetails(child, parent);
    const location: RecruiterOrderDetailsData = { physicalRequirements: ['Other'] };
    const result = mergeRecruiterOrderDetails(location, childPlusParent);
    expect(result.physicalRequirements).toEqual(['Other']);
  });
});

describe('mergeRecruiterOrderDetails — empty-string fallthrough (customUniformRequirements)', () => {
  it('falls through to parent when child has empty string', () => {
    const child: RecruiterOrderDetailsData = { customUniformRequirements: '' };
    const parent: RecruiterOrderDetailsData = { customUniformRequirements: PARENT_TEXT };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.customUniformRequirements).toBe(PARENT_TEXT);
  });

  it('falls through to parent when child has whitespace-only string', () => {
    const child: RecruiterOrderDetailsData = { customUniformRequirements: '   ' };
    const parent: RecruiterOrderDetailsData = { customUniformRequirements: PARENT_TEXT };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.customUniformRequirements).toBe(PARENT_TEXT);
  });

  it('uses child value when child has non-empty trimmed string', () => {
    const child: RecruiterOrderDetailsData = { customUniformRequirements: 'Hard hat required' };
    const parent: RecruiterOrderDetailsData = { customUniformRequirements: PARENT_TEXT };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.customUniformRequirements).toBe('Hard hat required');
  });

  it('returns empty string when both child and parent are empty', () => {
    const child: RecruiterOrderDetailsData = { customUniformRequirements: '' };
    const parent: RecruiterOrderDetailsData = { customUniformRequirements: '' };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.customUniformRequirements).toBe('');
  });

  it('returns empty string when both layers are absent', () => {
    const result = mergeRecruiterOrderDetails(undefined, undefined);
    expect(result.customUniformRequirements).toBe('');
  });
});

describe('mergeRecruiterOrderDetails — non-snapshot string fields keep existing spread semantics', () => {
  // experienceRequired etc. are NOT snapshot-policy; preserve the
  // pre-hotfix behavior so we don't accidentally widen the change.
  it('child empty string for experienceRequired wins over parent (existing behavior)', () => {
    const child: RecruiterOrderDetailsData = { experienceRequired: '' };
    const parent: RecruiterOrderDetailsData = { experienceRequired: '5 years' };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.experienceRequired).toBe('');
  });

  it('child undefined for experienceRequired falls back to parent', () => {
    const child: RecruiterOrderDetailsData = {};
    const parent: RecruiterOrderDetailsData = { experienceRequired: '5 years' };
    const result = mergeRecruiterOrderDetails(child, parent);
    expect(result.experienceRequired).toBe('5 years');
  });
});
