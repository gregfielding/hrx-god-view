/**
 * **R.16.2a Phase 1** — wrap test for the bulk JO loader inside
 * `loadEntityOnboardingEngineBuildContextAdmin.ts`.
 *
 * The bulk loader extracts `hiringEntityId` from each JO doc, then
 * falls through to a recruiter-account fallback when the JO read
 * returns nothing. Two contracts to lock:
 *
 *   1. The snapshot wins for non-draft JOs (preserving R.16.1 L2
 *      semantics in a bulk path).
 *   2. The recruiter-account fallback only fires when the wrap returns
 *      no value (live OR snapshotted) — i.e. the snapshot returning
 *      `'ent-A'` must short-circuit before the loader queries the
 *      recruiter account.
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

async function bulkResolveOne(
  jd: Record<string, unknown>,
  recruiterAccountFallback: () => Promise<string | null>,
): Promise<{ joHiring: string | null; effective: string | null; fallbackCalled: boolean }> {
  const { value: joHiring } = getEffectiveJobOrderField<string | null>(
    jd as JobOrderForEffectiveRead,
    'hiringEntityId',
    { fallback: (jd.hiringEntityId as string | null | undefined) ?? null },
  );
  let fallbackCalled = false;
  let effective: string | null = (joHiring as string | null) ?? null;
  if (!effective) {
    fallbackCalled = true;
    effective = await recruiterAccountFallback();
  }
  return { joHiring: (joHiring as string | null) ?? null, effective, fallbackCalled };
}

describe('R.16.2a — loadEntityOnboardingEngineBuildContextAdmin bulk wrap', () => {
  it('snapshot value short-circuits the recruiter-account fallback', async () => {
    const jd = {
      status: 'open',
      hiringEntityId: 'live-ent',
      recruiterAccountId: 'acct-1',
      snapshot: {
        capturedAt: TS,
        capturedBy: 'trigger',
        hiringEntityId: 'snapshot-ent',
      },
    };
    const result = await bulkResolveOne(jd, async () => 'fallback-from-account');
    expect(result.joHiring).to.equal('snapshot-ent');
    expect(result.effective).to.equal('snapshot-ent');
    expect(result.fallbackCalled).to.equal(false);
  });

  it('falls back to recruiter-account when snapshot is captured null AND live is empty', async () => {
    const jd = {
      status: 'open',
      hiringEntityId: '',
      recruiterAccountId: 'acct-1',
      snapshot: { capturedAt: TS, capturedBy: 'trigger', hiringEntityId: null },
    };
    const result = await bulkResolveOne(jd, async () => 'fallback-from-account');
    expect(result.joHiring).to.equal(null);
    expect(result.effective).to.equal('fallback-from-account');
    expect(result.fallbackCalled).to.equal(true);
  });

  it('on draft JO, the live read drives the result (snapshot ignored)', async () => {
    const jd = {
      status: 'draft',
      hiringEntityId: 'live-draft',
      recruiterAccountId: 'acct-1',
      snapshot: {
        capturedAt: TS,
        capturedBy: 'trigger',
        hiringEntityId: 'snapshot-ent',
      },
    };
    const result = await bulkResolveOne(jd, async () => 'fallback-from-account');
    expect(result.joHiring).to.equal('live-draft');
    expect(result.effective).to.equal('live-draft');
    expect(result.fallbackCalled).to.equal(false);
  });

  it('on pre-§16.1 active JO without a snapshot, live read drives the result', async () => {
    const jd = {
      status: 'open',
      hiringEntityId: 'pre-snapshot-live',
      recruiterAccountId: 'acct-1',
    };
    const result = await bulkResolveOne(jd, async () => 'fallback-from-account');
    expect(result.joHiring).to.equal('pre-snapshot-live');
    expect(result.effective).to.equal('pre-snapshot-live');
    expect(result.fallbackCalled).to.equal(false);
  });
});
