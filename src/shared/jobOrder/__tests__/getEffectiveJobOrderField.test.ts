/**
 * **R.16.1 Phase 7** — Unit tests for `getEffectiveJobOrderField` and
 * `getEffectiveJobOrderPositionField`.
 *
 * Pure helpers — no Firestore, no React, no async. Tests cover the
 * L2 precedence decision tree:
 *   - draft JO ignores snapshot
 *   - non-draft JO with no snapshot falls back
 *   - non-draft JO with snapshot value → snapshot wins
 *   - snapshot value `null` is honoured (deliberate freeze)
 *   - snapshot value `undefined` falls back
 *   - per-position lookup matches by positionId, falls back on miss
 *
 * Jest (CRA `npm test`).
 */

import {
  getEffectiveJobOrderField,
  getEffectiveJobOrderPositionField,
  type JobOrderForEffectiveRead,
} from '../getEffectiveJobOrderField';

const TS = '<<server_ts>>';

describe('getEffectiveJobOrderField — top-level snapshot precedence', () => {
  it('returns fallback for a draft JO even when snapshot is set', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'draft',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE',
    });
    expect(out.value).toEqual('PKG_LIVE');
    expect(out.source).toEqual('fallback');
  });

  it('returns fallback when JO is non-draft but has no snapshot', () => {
    const jo: JobOrderForEffectiveRead = { status: 'open' };
    const out = getEffectiveJobOrderField(jo, 'hiringEntityId', {
      fallback: 'entity_live',
    });
    expect(out.value).toEqual('entity_live');
    expect(out.source).toEqual('fallback');
  });

  it('returns fallback when snapshot blob is present but capturedAt is missing (defensive)', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_PARTIAL',
      } as never,
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE',
    });
    expect(out.value).toEqual('PKG_LIVE');
    expect(out.source).toEqual('fallback');
  });

  it('returns snapshot value when JO is non-draft and snapshot field is present', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE',
    });
    expect(out.value).toEqual('PKG_FROZEN');
    expect(out.source).toEqual('snapshot');
  });

  it('honours an explicit null snapshot value (deliberate freeze)', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        screeningPackageId: null,
      },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE_AFTER_ACTIVATION',
    });
    expect(out.value).toEqual(null);
    expect(out.source).toEqual('snapshot');
  });

  it('falls back when snapshot is present but the specific field is undefined (legacy snapshot)', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'backfill',
        screeningPackageId: 'PKG_A',
      },
    };
    const out = getEffectiveJobOrderField(jo, 'workersCompCode', {
      fallback: '8810',
    });
    expect(out.value).toEqual('8810');
    expect(out.source).toEqual('fallback');
  });

  it('returns absent (undefined value) when neither snapshot nor fallback has the field', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: { capturedAt: TS as never, capturedBy: 'trigger' },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId');
    expect(out.value).toBeUndefined();
    expect(out.source).toEqual('absent');
  });

  it('returns fallback for null/undefined JO doc', () => {
    const out1 = getEffectiveJobOrderField(null, 'screeningPackageId', {
      fallback: 'X',
    });
    expect(out1.value).toEqual('X');
    expect(out1.source).toEqual('fallback');

    const out2 = getEffectiveJobOrderField(undefined, 'screeningPackageId', {
      fallback: 'X',
    });
    expect(out2.source).toEqual('fallback');
  });

  it('treats missing status as draft (defensive)', () => {
    const jo: JobOrderForEffectiveRead = {
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE',
    });
    expect(out.value).toEqual('PKG_LIVE');
    expect(out.source).toEqual('fallback');
  });

  it('treats cancelled JOs the same as any other non-draft status (snapshot wins if present)', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'cancelled',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        screeningPackageId: 'PKG_FROZEN',
      },
    };
    const out = getEffectiveJobOrderField(jo, 'screeningPackageId', {
      fallback: 'PKG_LIVE',
    });
    expect(out.value).toEqual('PKG_FROZEN');
    expect(out.source).toEqual('snapshot');
  });
});

describe('getEffectiveJobOrderPositionField — per-position snapshot precedence', () => {
  it('returns the position sub-field from the snapshot when present', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [
          { positionId: 'p1', payRate: 18, billRate: 24, markupPercentage: 35 },
          { positionId: 'p2', payRate: 17, billRate: 22 },
        ],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p2', 'payRate', {
      fallback: 99,
    });
    expect(out.value).toEqual(17);
    expect(out.source).toEqual('snapshot');
  });

  it('falls back when positionId is not in the snapshot', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1', payRate: 18 }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p_missing', 'payRate', {
      fallback: 99,
    });
    expect(out.value).toEqual(99);
    expect(out.source).toEqual('fallback');
  });

  it('falls back on draft JO regardless of snapshot presence', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'draft',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1', payRate: 18 }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p1', 'payRate', {
      fallback: 99,
    });
    expect(out.value).toEqual(99);
    expect(out.source).toEqual('fallback');
  });

  it('falls back when snapshot exists but positions array is missing', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p1', 'payRate', {
      fallback: 99,
    });
    expect(out.value).toEqual(99);
    expect(out.source).toEqual('fallback');
  });

  it('falls back when positionId is empty string', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1', payRate: 18 }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, '', 'payRate', {
      fallback: 99,
    });
    expect(out.source).toEqual('fallback');
  });

  it('honours explicit null sub-field (e.g. deliberately frozen "no markup")', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1', markupPercentage: null }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p1', 'markupPercentage', {
      fallback: 35,
    });
    expect(out.value).toEqual(null);
    expect(out.source).toEqual('snapshot');
  });

  it('falls back when sub-field is undefined on the matched position', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1', payRate: 18 }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p1', 'billRate', {
      fallback: 24,
    });
    expect(out.value).toEqual(24);
    expect(out.source).toEqual('fallback');
  });

  it('returns absent when no fallback is provided and snapshot lookup misses', () => {
    const jo: JobOrderForEffectiveRead = {
      status: 'open',
      snapshot: {
        capturedAt: TS as never,
        capturedBy: 'trigger',
        positions: [{ positionId: 'p1' }],
      },
    };
    const out = getEffectiveJobOrderPositionField<number>(jo, 'p1', 'payRate');
    expect(out.value).toBeUndefined();
    expect(out.source).toEqual('absent');
  });
});
