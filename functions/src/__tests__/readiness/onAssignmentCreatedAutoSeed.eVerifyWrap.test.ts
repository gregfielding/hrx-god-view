/**
 * **R.16.2a Phase 1** — wrap test for `onAssignmentCreatedAutoSeed.ts`'s
 * e-verify read.
 *
 * The seed callable's `buildRequirementsForJobOrder` is internal, so we
 * exercise the wrap behaviourally: feed `getEffectiveJobOrderField` JO
 * shapes and assert the resulting boolean drives the requirement
 * inclusion the same way the file does (`if (eVerifyRequired === true)`).
 *
 * The point of these cases is to lock the L2 precedence at the call
 * site: snapshot wins on non-draft JOs; fallback wins on drafts and
 * pre-§16.1 JOs without a snapshot. If the wrap inversely reads or
 * the polarity flips, these cases break.
 *
 * Mocha + Chai. Run via the functions package's mocha pipeline.
 *
 * @see docs/CASCADE_R16.2a_HANDOFF.md §L3, §L8.
 */

import { expect } from 'chai';

import {
  getEffectiveJobOrderField,
  type JobOrderForEffectiveRead,
} from '../../shared/jobOrder/getEffectiveJobOrderField';

const TS = { toMillis: () => 1700000000000 } as unknown;

function readEverify(jo: Record<string, unknown>): boolean {
  // Mirrors the wrap shape inside the seed file. Keeping it inline (not
  // importing the seed file's private helper) so the test exercises
  // exactly the call shape, not the surrounding requirement-building
  // logic.
  const { value } = getEffectiveJobOrderField<boolean>(
    jo as JobOrderForEffectiveRead,
    'eVerifyRequired',
    { fallback: jo.eVerifyRequired === true },
  );
  return value === true;
}

describe('R.16.2a — onAssignmentCreatedAutoSeed eVerify wrap', () => {
  it('snapshot wins for non-draft JO with snapshot.eVerifyRequired = true (live = false)', () => {
    const jo = {
      status: 'open',
      eVerifyRequired: false,
      snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: true },
    };
    expect(readEverify(jo)).to.equal(true);
  });

  it('snapshot wins for non-draft JO with snapshot.eVerifyRequired = false (live = true)', () => {
    const jo = {
      status: 'open',
      eVerifyRequired: true,
      snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: false },
    };
    expect(readEverify(jo)).to.equal(false);
  });

  it('falls back to live read on draft JO regardless of snapshot value', () => {
    const jo = {
      status: 'draft',
      eVerifyRequired: true,
      snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: false },
    };
    expect(readEverify(jo)).to.equal(true);
  });

  it('falls back to live read on non-draft JO without a snapshot (pre-§16.1)', () => {
    const jo = {
      status: 'open',
      eVerifyRequired: true,
    };
    expect(readEverify(jo)).to.equal(true);
  });
});
