/**
 * **R.2** — Unit tests for `matchPpeWillingness`.
 *
 * Behaviour scope: input → status mapping per D8.R2. Distinct from
 * `ppe_acknowledgement` (per-shift hard gate) — this is the standing
 * willingness answer.
 *
 * @see shared/jobRequirementMatchers/matchPpeWillingness.ts
 */

import { matchPpeWillingness } from '../jobRequirementMatchers/matchPpeWillingness';

describe('matchPpeWillingness — D8.R2 status mapping', () => {
  it("'yes' → complete_pass", () => {
    expect(matchPpeWillingness({ willingness: 'yes' }).status).toBe('complete_pass');
  });
  it("'maybe' → needs_review", () => {
    expect(matchPpeWillingness({ willingness: 'maybe' }).status).toBe('needs_review');
  });
  it("'no' → complete_fail", () => {
    expect(matchPpeWillingness({ willingness: 'no' }).status).toBe('complete_fail');
  });
  it.each([null, undefined, '', 'unknown'])('not-picked %p → incomplete', (v) => {
    expect(matchPpeWillingness({ willingness: v as never }).status).toBe('incomplete');
  });
});

describe('matchPpeWillingness — Title-Case tolerance', () => {
  it("'Yes' → complete_pass", () => {
    expect(matchPpeWillingness({ willingness: 'Yes' }).status).toBe('complete_pass');
  });
  it("'No' → complete_fail", () => {
    expect(matchPpeWillingness({ willingness: 'No' }).status).toBe('complete_fail');
  });
  it("'Maybe' → needs_review", () => {
    expect(matchPpeWillingness({ willingness: 'Maybe' }).status).toBe('needs_review');
  });
});

describe('matchPpeWillingness — reason codes are stable', () => {
  it('emits scoped reason codes per status', () => {
    expect(matchPpeWillingness({ willingness: 'yes' }).reason).toBe('ppe_willingness_yes');
    expect(matchPpeWillingness({ willingness: 'no' }).reason).toBe('ppe_willingness_no');
    expect(matchPpeWillingness({ willingness: 'maybe' }).reason).toBe('ppe_willingness_maybe');
    expect(matchPpeWillingness({ willingness: null }).reason).toBe(
      'ppe_willingness_not_picked',
    );
  });
});
