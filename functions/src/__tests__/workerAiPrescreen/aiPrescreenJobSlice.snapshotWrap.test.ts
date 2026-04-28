/**
 * **R.16.2a Phase 1** — wrap test for `aiPrescreenJobSlice.ts`'s
 * `extractJobSliceFromJobOrder`. Two snapshot-policy fields land in
 * the prescreen slice: `eVerifyRequired` and `hiringEntityId`.
 *
 * The companion `extractJobSliceFromPosting` is intentionally NOT
 * wrapped (postings are not JO docs — Q5 lock defers to R.16.2b);
 * we assert here that the merge between the two extractors still
 * works in the unmodified direction.
 *
 * Mocha + Chai. Run via the functions package's mocha pipeline.
 *
 * @see docs/CASCADE_R16.2a_HANDOFF.md §L3, §L8.
 */

import { expect } from 'chai';

import {
  extractJobSliceFromJobOrder,
  extractJobSliceFromPosting,
  mergePostingAndOrderSlices,
} from '../../workerAiPrescreen/aiPrescreenJobSlice';

const TS = { toMillis: () => 1700000000000 } as unknown;

describe('R.16.2a — aiPrescreenJobSlice JO-extractor snapshot wrap', () => {
  describe('eVerifyRequired', () => {
    it('snapshot wins on non-draft JO (snapshot=true, live=false)', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: false,
        status: 'open',
        snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: true },
      });
      expect(slice.requiresEVerify).to.equal(true);
    });

    it('snapshot wins on non-draft JO (snapshot=false, live=true)', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: true,
        status: 'open',
        snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: false },
      });
      expect(slice.requiresEVerify).to.equal(false);
    });

    it('falls back to live read on draft JO', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: true,
        status: 'draft',
        snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: false },
      });
      expect(slice.requiresEVerify).to.equal(true);
    });

    it('falls back to live read on pre-§16.1 active JO without snapshot', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: true,
        status: 'open',
      });
      expect(slice.requiresEVerify).to.equal(true);
    });
  });

  describe('hiringEntityId', () => {
    it('snapshot wins on non-draft JO when both snapshot and live are set', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        hiringEntityId: 'live-entity',
        status: 'open',
        snapshot: {
          capturedAt: TS,
          capturedBy: 'trigger',
          hiringEntityId: 'snapshotted-entity',
        },
      });
      expect(slice.hiringEntityId).to.equal('snapshotted-entity');
    });

    it('honours an explicit `null` snapshot value (deliberate freeze)', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        hiringEntityId: 'live-entity',
        status: 'open',
        snapshot: { capturedAt: TS, capturedBy: 'trigger', hiringEntityId: null },
      });
      expect(slice.hiringEntityId).to.equal(null);
    });

    it('falls back to live read on draft JO', () => {
      const slice = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        hiringEntityId: 'live-entity',
        status: 'draft',
        snapshot: {
          capturedAt: TS,
          capturedBy: 'trigger',
          hiringEntityId: 'snapshotted-entity',
        },
      });
      expect(slice.hiringEntityId).to.equal('live-entity');
    });
  });

  describe('non-JO posting extractor untouched (Q5 lock)', () => {
    it('extractJobSliceFromPosting reads live `eVerifyRequired` regardless of any snapshot blob', () => {
      const slice = extractJobSliceFromPosting({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: true,
        // Even if a posting somehow carries a snapshot blob (it shouldn't),
        // the wrap is intentionally absent — postings are not JO docs.
        snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: false },
      });
      expect(slice.requiresEVerify).to.equal(true);
    });

    it('merge keeps order-side wrap behaviour (snapshot-driven) over posting live read', () => {
      const posting = extractJobSliceFromPosting({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: false,
      });
      const order = extractJobSliceFromJobOrder({
        jobTitle: 'Forklift Operator',
        eVerifyRequired: false,
        status: 'open',
        snapshot: { capturedAt: TS, capturedBy: 'trigger', eVerifyRequired: true },
      });
      const merged = mergePostingAndOrderSlices(posting, order);
      // Merger ORs the screening flags, so true-from-snapshot stays true.
      expect(merged.requiresEVerify).to.equal(true);
    });
  });
});
