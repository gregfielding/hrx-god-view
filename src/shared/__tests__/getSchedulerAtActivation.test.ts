/**
 * **R.16.2d** — Helper tests for `getSchedulerAtActivation` and
 * `shouldRenderActivationSubline`.
 *
 * Locks the L.16.2d.5 test surface from
 * `docs/CLEANUP_R4_R16.2D_HANDOFF.md`:
 *
 *   Reader:
 *     1. draft JO → null (pre-activation, no snapshot semantics)
 *     2. non-draft + no snapshot.capturedAt → null
 *     3. non-draft + snapshot.capturedAt + scheduler:[] → [] (distinct from null)
 *     4. non-draft + snapshot.capturedAt + scheduler:['a','','b','a'] →
 *        ['a','b'] (trimmed, dedup, first-seen order, empties skipped)
 *     5. non-draft + snapshot.capturedAt + scheduler missing/non-array → null
 *
 *   Predicate:
 *     6. activationSchedulers === null → false (no signal)
 *     7. activationSchedulers === [] → false (no useful signal)
 *     8. activation === ['a'] AND current === 'a' → false (no divergence)
 *     9. activation === ['a'] AND current === 'b' → true (different uid)
 *    10. activation === ['a','b'] AND current === 'a' → true (set size differs)
 *    11. activation === ['a'] AND current === null → true (current cleared)
 *    12. activation === ['  a  '] AND current === 'a' → false (trim parity)
 */

import {
  getSchedulerAtActivation,
  shouldRenderActivationSubline,
  type JobOrderForSchedulerActivation,
} from '../jobOrder/getSchedulerAtActivation';

const T = '2026-04-27T12:00:00.000Z';

function jo(over: Partial<JobOrderForSchedulerActivation>): JobOrderForSchedulerActivation {
  return {
    status: 'active',
    schedulerUid: null,
    snapshot: { capturedAt: T, scheduler: [] },
    ...over,
  };
}

describe('getSchedulerAtActivation', () => {
  it('(1) returns null for draft JOs (pre-activation has no snapshot semantics)', () => {
    const r = getSchedulerAtActivation(
      jo({ status: 'draft', snapshot: { capturedAt: T, scheduler: ['alice'] } }),
    );
    expect(r).toBeNull();
  });

  it('(2) returns null when snapshot has no capturedAt (partial-write defensive)', () => {
    const r = getSchedulerAtActivation(
      jo({ snapshot: { scheduler: ['alice'] } as never }),
    );
    expect(r).toBeNull();
  });

  it('(3) returns [] (NOT null) when activation captured an empty scheduler list', () => {
    const r = getSchedulerAtActivation(
      jo({ snapshot: { capturedAt: T, scheduler: [] } }),
    );
    // Distinct from `null` so consumers can disambiguate "no schedulers
    // at activation" from "no snapshot at all" in audit / future use.
    expect(r).toEqual([]);
  });

  it("(4) trims, dedups, drops empties, preserves first-seen order", () => {
    const r = getSchedulerAtActivation(
      jo({ snapshot: { capturedAt: T, scheduler: ['  a  ', '', 'b', 'a', '   ', 'b'] } }),
    );
    expect(r).toEqual(['a', 'b']);
  });

  it("(5) returns null when snapshot.scheduler is missing or not an array", () => {
    const missing = getSchedulerAtActivation(
      jo({ snapshot: { capturedAt: T } as never }),
    );
    expect(missing).toBeNull();

    const wrongShape = getSchedulerAtActivation(
      jo({ snapshot: { capturedAt: T, scheduler: 'alice' as never } }),
    );
    expect(wrongShape).toBeNull();
  });

  it('returns null for null/undefined doc (defensive)', () => {
    expect(getSchedulerAtActivation(null)).toBeNull();
    expect(getSchedulerAtActivation(undefined)).toBeNull();
  });

  it('returns null when status is missing (treated as draft)', () => {
    const r = getSchedulerAtActivation(
      jo({ status: null, snapshot: { capturedAt: T, scheduler: ['alice'] } }),
    );
    expect(r).toBeNull();
  });
});

describe('shouldRenderActivationSubline', () => {
  it('(6) returns false when activationSchedulers is null (no snapshot signal)', () => {
    expect(
      shouldRenderActivationSubline({ currentSchedulerUid: 'a', activationSchedulers: null }),
    ).toBe(false);
  });

  it('(7) returns false when activationSchedulers is empty (no useful signal)', () => {
    expect(
      shouldRenderActivationSubline({ currentSchedulerUid: 'a', activationSchedulers: [] }),
    ).toBe(false);
  });

  it('(8) returns false when activation === current (no divergence)', () => {
    expect(
      shouldRenderActivationSubline({ currentSchedulerUid: 'a', activationSchedulers: ['a'] }),
    ).toBe(false);
  });

  it('(9) returns true when activation differs from current (single uid swap)', () => {
    expect(
      shouldRenderActivationSubline({ currentSchedulerUid: 'b', activationSchedulers: ['a'] }),
    ).toBe(true);
  });

  it('(10) returns true when activation set is larger than current', () => {
    expect(
      shouldRenderActivationSubline({
        currentSchedulerUid: 'a',
        activationSchedulers: ['a', 'b'],
      }),
    ).toBe(true);
  });

  it('(11) returns true when current was cleared (current null, activation populated)', () => {
    expect(
      shouldRenderActivationSubline({
        currentSchedulerUid: null,
        activationSchedulers: ['a'],
      }),
    ).toBe(true);
  });

  it('(12) returns false when activation matches current modulo trim/whitespace', () => {
    expect(
      shouldRenderActivationSubline({
        currentSchedulerUid: 'a',
        activationSchedulers: ['  a  '],
      }),
    ).toBe(false);
  });

  it('returns false when both sides are effectively empty', () => {
    expect(
      shouldRenderActivationSubline({
        currentSchedulerUid: '',
        activationSchedulers: [''],
      }),
    ).toBe(false);
  });

  it('treats whitespace-only entries as empty (filtered out before set comparison)', () => {
    expect(
      shouldRenderActivationSubline({
        currentSchedulerUid: '   ',
        activationSchedulers: ['  ', '\t'],
      }),
    ).toBe(false);
  });
});
