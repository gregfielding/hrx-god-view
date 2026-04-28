/**
 * **R.16.2a Phase 1** — wrap test for
 * `workerOnboardingPipeline.ts:resolveEntityContext`.
 *
 * The `resolveEntityContext` helper is intentionally not exported, so
 * the wrap is exercised behaviourally through `getEffectiveJobOrderField`
 * with the same call shape used inside the pipeline file.
 *
 * The wrap replaces:
 *   `(jo.hiringEntityId as string) || (jo.entityId as string) || null`
 * with:
 *   `(snapshotHiring as string | null) || (jo.entityId as string) || null`
 *
 * The new contract is: snapshot wins for non-draft JOs, fallback (the
 * legacy live read) wins for drafts and pre-§16.1 active JOs without
 * a snapshot. `entityId` continues to act as the second-tier fallback.
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

function resolveFromJo(jo: Record<string, unknown>): string | null {
  const { value: snapshotHiring } = getEffectiveJobOrderField<string | null>(
    jo as JobOrderForEffectiveRead,
    'hiringEntityId',
    { fallback: (jo.hiringEntityId as string) || null },
  );
  return (snapshotHiring as string | null) || (jo.entityId as string) || null;
}

describe('R.16.2a — workerOnboardingPipeline hiringEntity wrap', () => {
  it('snapshot wins on non-draft JO (snapshot=ent-A, live=ent-B)', () => {
    const jo = {
      status: 'open',
      hiringEntityId: 'ent-B',
      entityId: 'ent-X',
      snapshot: {
        capturedAt: TS,
        capturedBy: 'trigger',
        hiringEntityId: 'ent-A',
      },
    };
    expect(resolveFromJo(jo)).to.equal('ent-A');
  });

  it('falls back to JO live `hiringEntityId` on draft', () => {
    const jo = {
      status: 'draft',
      hiringEntityId: 'ent-B',
      entityId: 'ent-X',
      snapshot: {
        capturedAt: TS,
        capturedBy: 'trigger',
        hiringEntityId: 'ent-A',
      },
    };
    expect(resolveFromJo(jo)).to.equal('ent-B');
  });

  it('falls back to JO live `hiringEntityId` on non-draft JO without a snapshot', () => {
    const jo = {
      status: 'open',
      hiringEntityId: 'ent-B',
      entityId: 'ent-X',
    };
    expect(resolveFromJo(jo)).to.equal('ent-B');
  });

  it('falls back through to `entityId` when snapshot returns null and live is empty', () => {
    // The wrap returns `null` from the helper when the snapshot
    // explicitly captured `null` (deliberate freeze). The downstream
    // `||` chain in `resolveEntityContext` then falls through to
    // `entityId`. Locking that behaviour here so a future "snapshot
    // wins absolutely" refactor doesn't silently break the pipeline.
    const jo = {
      status: 'open',
      hiringEntityId: '',
      entityId: 'ent-X',
      snapshot: {
        capturedAt: TS,
        capturedBy: 'trigger',
        hiringEntityId: null,
      },
    };
    expect(resolveFromJo(jo)).to.equal('ent-X');
  });
});
