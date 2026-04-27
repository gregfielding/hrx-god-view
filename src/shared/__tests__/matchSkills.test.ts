/**
 * Unit tests for `matchSkills`. Covers all three strictness modes.
 *
 * @see shared/jobRequirementMatchers/matchSkills.ts
 */

import { matchSkills } from '../jobRequirementMatchers/matchSkills';

describe('matchSkills — defaults & shape', () => {
  it('defaults to tokenized strictness', () => {
    const r = matchSkills({
      required: 'forklift',
      workerSkills: ['Certified Forklift Operator'],
    });
    expect(r.status).toBe('complete_pass');
    expect(r.details?.strictness).toBe('tokenized');
  });

  it('returns not_applicable for empty / blank required', () => {
    expect(matchSkills({ required: '' }).status).toBe('not_applicable');
    expect(matchSkills({ required: '   ' }).status).toBe('not_applicable');
  });

  it('returns incomplete when worker has no skills', () => {
    expect(matchSkills({ required: 'forklift' }).status).toBe('incomplete');
    expect(matchSkills({ required: 'forklift', workerSkills: [] }).status).toBe('incomplete');
    expect(matchSkills({ required: 'forklift', workerSkills: null }).status).toBe('incomplete');
  });

  it('accepts both string and {name} worker skill shapes', () => {
    const r = matchSkills({
      required: 'forklift',
      workerSkills: [{ name: 'Forklift' }, 'pallet jack'],
      strictness: 'exact',
    });
    expect(r.status).toBe('complete_pass');
    expect(r.details?.matchedSkill).toBe('Forklift');
  });
});

describe('matchSkills — exact', () => {
  it('matches case-insensitively on trimmed values', () => {
    const r = matchSkills({
      required: 'Forklift',
      workerSkills: ['  forklift  '],
      strictness: 'exact',
    });
    expect(r.status).toBe('complete_pass');
  });

  it('does not match partials', () => {
    const r = matchSkills({
      required: 'forklift',
      workerSkills: ['Forklift Operator'],
      strictness: 'exact',
    });
    expect(r.status).toBe('complete_fail');
  });
});

describe('matchSkills — tokenized', () => {
  it('matches when all required tokens are in worker skill', () => {
    const r = matchSkills({
      required: 'forklift operator',
      workerSkills: ['Certified Forklift Operator (sit-down)'],
      strictness: 'tokenized',
    });
    expect(r.status).toBe('complete_pass');
  });

  it('matches via substring fallback when tokens are out of order', () => {
    // "forklift operator" appears as a phrase within the worker skill.
    const r = matchSkills({
      required: 'forklift operator',
      workerSkills: ['Forklift Operator Class III'],
      strictness: 'tokenized',
    });
    expect(r.status).toBe('complete_pass');
  });

  it('fails when required tokens are not all present', () => {
    const r = matchSkills({
      required: 'forklift trainer',
      workerSkills: ['Forklift Operator'],
      strictness: 'tokenized',
    });
    expect(r.status).toBe('complete_fail');
  });

  it('handles non-alphanumeric separators in skill names', () => {
    const r = matchSkills({
      required: 'OSHA-30',
      workerSkills: ['osha 30 general industry'],
      strictness: 'tokenized',
    });
    expect(r.status).toBe('complete_pass');
  });
});

describe('matchSkills — fuzzy', () => {
  it('matches when required is a substring of worker skill', () => {
    const r = matchSkills({
      required: 'forklift',
      workerSkills: ['Certified Forklift Operator'],
      strictness: 'fuzzy',
    });
    expect(r.status).toBe('complete_pass');
  });

  it('matches when worker skill is a substring of required', () => {
    const r = matchSkills({
      required: 'forklift operator class III',
      workerSkills: ['forklift'],
      strictness: 'fuzzy',
    });
    expect(r.status).toBe('complete_pass');
  });

  it('fails when neither side is a substring of the other', () => {
    const r = matchSkills({
      required: 'forklift',
      workerSkills: ['warehouse picker'],
      strictness: 'fuzzy',
    });
    expect(r.status).toBe('complete_fail');
  });
});
