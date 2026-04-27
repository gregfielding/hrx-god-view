/**
 * **R.2** — Unit tests for `matchLanguageWillingness`. Distinct from
 * `matchLanguages` (proficiency); this matcher reads only the worker's
 * standing comfort answer and maps via D8.R2.
 *
 * @see shared/jobRequirementMatchers/matchLanguageWillingness.ts
 */

import { matchLanguageWillingness } from '../jobRequirementMatchers/matchLanguageWillingness';

describe('matchLanguageWillingness — D8.R2 status mapping', () => {
  it("'yes' → complete_pass", () => {
    expect(matchLanguageWillingness({ willingness: 'yes' }).status).toBe('complete_pass');
  });
  it("'maybe' → needs_review", () => {
    expect(matchLanguageWillingness({ willingness: 'maybe' }).status).toBe('needs_review');
  });
  it("'no' → complete_fail", () => {
    expect(matchLanguageWillingness({ willingness: 'no' }).status).toBe('complete_fail');
  });
  it.each([null, undefined, '', 'something_else'])('not-picked %p → incomplete', (v) => {
    expect(matchLanguageWillingness({ willingness: v as never }).status).toBe('incomplete');
  });
});

describe('matchLanguageWillingness — Title-Case tolerance', () => {
  it.each<[string, string]>([
    ['Yes', 'complete_pass'],
    ['No', 'complete_fail'],
    ['Maybe', 'needs_review'],
  ])('%p → %p', (input, expected) => {
    expect(matchLanguageWillingness({ willingness: input }).status).toBe(expected);
  });
});

describe('matchLanguageWillingness — reason codes', () => {
  it('emits scoped reason codes per status', () => {
    expect(matchLanguageWillingness({ willingness: 'yes' }).reason).toBe(
      'language_willingness_yes',
    );
    expect(matchLanguageWillingness({ willingness: 'no' }).reason).toBe(
      'language_willingness_no',
    );
    expect(matchLanguageWillingness({ willingness: 'maybe' }).reason).toBe(
      'language_willingness_maybe',
    );
    expect(matchLanguageWillingness({ willingness: null }).reason).toBe(
      'language_willingness_not_picked',
    );
  });
});
