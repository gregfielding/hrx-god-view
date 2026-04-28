/**
 * **R.16.2a Phase 2** — wrap tests for the four CRA-side consumers
 * that adopt `getEffectiveJobOrderField` / `getEffectiveJobOrderPositionField`.
 *
 * The four wrap files are:
 *   - `src/components/JobOrderForm.tsx`              (top-level hiringEntityId)
 *   - `src/components/recruiter/PlacementsTab.tsx`   (top-level hiringEntityId)
 *   - `src/components/apply/Wizard.tsx`              (top-level hiringEntityId, two read sites)
 *   - `src/hooks/useActiveShifts.ts`                 (per-position pay/bill/markup/wcRate)
 *
 * Each wrap's logic is small (compose helper call → pluck `.value`),
 * so the tests exercise the wrap shape directly through
 * `getEffectiveJobOrderField` / `getEffectiveJobOrderPositionField`,
 * mirroring the helper-call exactly as the consumer does. The R.16.1
 * Phase 7 jest suite already covers the helper's full decision tree;
 * these cases lock the per-consumer fallback expressions and the L5
 * top-level-vs-per-position split for `useActiveShifts.readJoFinancials`.
 *
 * Jest (CRA `npm test`).
 *
 * @see docs/CASCADE_R16.2a_HANDOFF.md §L3, §L5, §L8.
 */

import {
  getEffectiveJobOrderField,
  getEffectiveJobOrderPositionField,
  type JobOrderForEffectiveRead,
} from '../../shared/jobOrder/getEffectiveJobOrderField';

const TS = '<<server_ts>>';

// ─────────────────────────────────────────────────────────────────────
// JobOrderForm — `hiringEntityIdForForm` composite wrap.
// Replaces a 4-tier `??` chain with a snapshot-aware read where the
// JO snapshot wins for non-draft JOs and the legacy chain becomes the
// fallback. Test the resolution by composing the same shape.
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2a — JobOrderForm hiringEntityIdForForm wrap', () => {
  function resolve(
    recruiterAccountHiring: string | null,
    initialDataHiring: string | null | undefined,
    jobOrder: (JobOrderForEffectiveRead & { hiringEntityId?: string | null }) | null,
    loadedJoDataHiring: string | null | undefined,
  ): string | null {
    const fallback =
      recruiterAccountHiring ??
      initialDataHiring ??
      jobOrder?.hiringEntityId ??
      loadedJoDataHiring ??
      null;
    const { value } = getEffectiveJobOrderField<string | null>(
      jobOrder ?? null,
      'hiringEntityId',
      { fallback },
    );
    return (value as string | null) ?? null;
  }

  it('snapshot wins on non-draft JO over the entire fallback chain', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'jo-live',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: 'jo-snapshot' },
    };
    expect(resolve('rec-acct', 'initial', jo, 'loaded')).toEqual('jo-snapshot');
  });

  it('falls back to recruiter-account hiring entity when snapshot is absent and rec-acct is set', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'jo-live',
    };
    expect(resolve('rec-acct', 'initial', jo, 'loaded')).toEqual('rec-acct');
  });

  it('falls back through to JO live `hiringEntityId` on draft (snapshot ignored)', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'draft',
      hiringEntityId: 'jo-live',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: 'jo-snapshot' },
    };
    expect(resolve(null, undefined, jo, 'loaded')).toEqual('jo-live');
  });

  it('returns null when nothing is set anywhere', () => {
    expect(resolve(null, undefined, null, undefined)).toEqual(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// PlacementsTab — `hiringEntityId` composite. `placementHiringEntityId`
// (the placement-level pin) wins absolutely; below that, the snapshot-
// aware read takes over. Test that pin > snapshot, and snapshot > live.
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2a — PlacementsTab hiringEntityId wrap', () => {
  function resolve(
    placementHiringEntityId: string | null | undefined,
    jobOrder: (JobOrderForEffectiveRead & { hiringEntityId?: string | null }) | null,
  ): string {
    const { value: joHiring } = getEffectiveJobOrderField<string | null>(
      jobOrder ?? null,
      'hiringEntityId',
      { fallback: jobOrder?.hiringEntityId ?? null },
    );
    return String(placementHiringEntityId ?? joHiring ?? '').trim();
  }

  it('placement-level pin wins over snapshot', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'jo-live',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: 'jo-snapshot' },
    };
    expect(resolve('placement-pin', jo)).toEqual('placement-pin');
  });

  it('snapshot wins over live JO when placement pin is absent', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'jo-live',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: 'jo-snapshot' },
    };
    expect(resolve(null, jo)).toEqual('jo-snapshot');
  });

  it('falls back to live JO read on a non-draft JO without a snapshot', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'jo-live',
    };
    expect(resolve(null, jo)).toEqual('jo-live');
  });

  it('returns empty string when nothing is set anywhere', () => {
    expect(resolve(null, null)).toEqual('');
  });
});

// ─────────────────────────────────────────────────────────────────────
// apply/Wizard — two near-identical reads. Test once: snapshot wins on
// non-draft JO; fallback wins on draft. The second read site has the
// same shape, so a single pair locks both.
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2a — apply/Wizard hiringEntityId wrap', () => {
  function resolveFromJoDoc(
    jo: (JobOrderForEffectiveRead & { hiringEntityId?: string | null }) | null,
  ): string | null {
    const { value } = getEffectiveJobOrderField<string | null>(
      jo ?? null,
      'hiringEntityId',
      { fallback: jo?.hiringEntityId ?? null },
    );
    return (value as string | null) ?? null;
  }

  it('snapshot wins on non-draft JO (apply flow uses the captured entity)', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'live-applied-after-edit',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        hiringEntityId: 'frozen-at-activation',
      },
    };
    expect(resolveFromJoDoc(jo)).toEqual('frozen-at-activation');
  });

  it('falls back to live JO read on draft', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'draft',
      hiringEntityId: 'live-draft',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: 'snap' },
    };
    expect(resolveFromJoDoc(jo)).toEqual('live-draft');
  });

  it('honours snapshot null (deliberate freeze) — returns null even when live is set', () => {
    const jo: JobOrderForEffectiveRead & { hiringEntityId?: string | null } = {
      status: 'open',
      hiringEntityId: 'live-set',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger', hiringEntityId: null },
    };
    expect(resolveFromJoDoc(jo)).toEqual(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// useActiveShifts — per-position rate wrap. Tests the L5 split:
// flat top-level reads stay unwrapped; per-position reads flow through
// `getEffectiveJobOrderPositionField`. Locks the four wrapped fields:
// payRate, billRate, markupPercentage, workersCompRate.
// ─────────────────────────────────────────────────────────────────────

describe('R.16.2a — useActiveShifts per-position rate wrap (L5)', () => {
  // Tiny mirror of the wrap shape inside `readJoFinancials` so the test
  // exercises the same composition.
  function readPositionRate(
    jo: JobOrderForEffectiveRead,
    positionId: string,
    subField: 'payRate' | 'billRate' | 'workersCompRate' | 'markupPercentage',
    legacyFallback: number | undefined,
  ): number | undefined {
    if (!positionId) return legacyFallback;
    const { value } = getEffectiveJobOrderPositionField<number>(
      jo,
      positionId,
      subField,
      { fallback: legacyFallback },
    );
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  it('snapshot pay rate wins over live `positions[i].payRate`', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        positions: [{ positionId: 'pos-1', payRate: 18.5 }],
      },
    };
    expect(readPositionRate(jo, 'pos-1', 'payRate', 17)).toEqual(18.5);
  });

  it('snapshot bill rate wins; markup follows the same snapshot record', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        positions: [
          { positionId: 'pos-1', payRate: 18.5, billRate: 27, markupPercentage: 45.946 },
        ],
      },
    };
    expect(readPositionRate(jo, 'pos-1', 'billRate', 25)).toEqual(27);
    expect(readPositionRate(jo, 'pos-1', 'markupPercentage', 30)).toBeCloseTo(45.946, 3);
  });

  it("snapshot workersCompRate wins over per-position live read", () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        positions: [{ positionId: 'pos-1', workersCompRate: 7.42 }],
      },
    };
    expect(readPositionRate(jo, 'pos-1', 'workersCompRate', 5.99)).toEqual(7.42);
  });

  it('fallback wins on draft JO even when snapshot has the position', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'draft',
      snapshot: {
        capturedAt: TS as never,
        positions: [{ positionId: 'pos-1', payRate: 18.5 }],
      },
    };
    expect(readPositionRate(jo, 'pos-1', 'payRate', 17)).toEqual(17);
  });

  it('fallback wins when the requested positionId is not in snapshot.positions', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        positions: [{ positionId: 'pos-A', payRate: 18.5 }],
      },
    };
    expect(readPositionRate(jo, 'pos-B', 'payRate', 17)).toEqual(17);
  });

  it('fallback wins when positionId is empty (no per-position context available)', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        positions: [{ positionId: 'pos-1', payRate: 18.5 }],
      },
    };
    expect(readPositionRate(jo, '', 'payRate', 17)).toEqual(17);
  });
});
