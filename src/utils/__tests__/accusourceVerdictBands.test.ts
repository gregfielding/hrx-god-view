/**
 * AC.0a — Pure helper tests for `accusourceVerdictBands`.
 *
 * Locks the band-grouping behavior used by the User Profile → Backgrounds
 * tab so a future enum change (e.g. an `EXPIRED` verdict) doesn't silently
 * route lines into the wrong bucket. RTL component tests live in
 * `src/pages/UserProfile/components/__tests__/AccusourceOrderServiceLinesTable.bands.test.tsx`.
 */

import type { AccusourceLineVerdict } from '../../types/backgroundCheck';
import type { AccusourceScreeningLineItem } from '../accusourceScreeningLineItems';
import {
  BAND_DEFAULT_COLLAPSED,
  BAND_LABEL,
  BAND_ORDER,
  cardHeaderSubBadge,
  groupLinesByBand,
  isAllPendingState,
  isSyntheticOrderRow,
  totalVisibleLineCount,
  verdictBand,
} from '../accusourceVerdictBands';

/** Minimal line factory — only the fields the band helpers actually read. */
function makeLine(
  id: string,
  verdict: AccusourceLineVerdict,
  overrides: Partial<AccusourceScreeningLineItem> = {},
): AccusourceScreeningLineItem {
  return {
    id,
    name: overrides.name ?? `Service ${id}`,
    status: overrides.status ?? 'Pending',
    verdict,
    verdictOverridden: overrides.verdictOverridden ?? false,
    ...overrides,
  } as AccusourceScreeningLineItem;
}

describe('verdictBand', () => {
  test('1:1 maps each canonical verdict to the same-named band', () => {
    expect(verdictBand('PASSED')).toBe('PASSED');
    expect(verdictBand('FAILED')).toBe('FAILED');
    expect(verdictBand('NEEDS_REVIEW')).toBe('NEEDS_REVIEW');
    expect(verdictBand('PENDING')).toBe('PENDING');
  });

  test('falls back to PENDING for any unknown verdict (defensive — won\'t surface as actionable)', () => {
    // Cast to AccusourceLineVerdict | string is the API shape; runtime fallback is what we care about.
    expect(verdictBand('EXPIRED')).toBe('PENDING');
    expect(verdictBand('')).toBe('PENDING');
    expect(verdictBand('something-future')).toBe('PENDING');
  });
});

describe('BAND_ORDER + display constants', () => {
  test('renders bands in the spec-mandated order: NEEDS_REVIEW, FAILED, PENDING, PASSED', () => {
    expect([...BAND_ORDER]).toEqual(['NEEDS_REVIEW', 'FAILED', 'PENDING', 'PASSED']);
  });

  test('PENDING + PASSED collapsed by default; NEEDS_REVIEW + FAILED expanded', () => {
    expect(BAND_DEFAULT_COLLAPSED.has('PENDING')).toBe(true);
    expect(BAND_DEFAULT_COLLAPSED.has('PASSED')).toBe(true);
    expect(BAND_DEFAULT_COLLAPSED.has('NEEDS_REVIEW')).toBe(false);
    expect(BAND_DEFAULT_COLLAPSED.has('FAILED')).toBe(false);
  });

  test('every band has a user-facing label', () => {
    for (const band of BAND_ORDER) {
      const label = BAND_LABEL[band];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  test('BAND_ORDER is frozen — production code can\'t mutate it accidentally', () => {
    // `Object.isFrozen` returns true for `Object.freeze([...])`. Calling
    // `push` should throw under strict mode (which Jest enables by default).
    expect(Object.isFrozen(BAND_ORDER)).toBe(true);
  });
});

describe('isSyntheticOrderRow', () => {
  test('detects contentless placeholders: "Order N" name with nothing actionable', () => {
    // The line builder ALREADY rewrites these to "County Criminal · {jurisdiction}"
    // when jurisdiction info exists, so a still-"Order N" row that is also
    // PENDING has no information to surface — safe to filter.
    expect(
      isSyntheticOrderRow(makeLine('68208', 'PENDING', { name: 'Order 8534895' })),
    ).toBe(true);
    expect(
      isSyntheticOrderRow(makeLine('68208', 'PENDING', { name: 'order PRO-123' })),
    ).toBe(true);
    // Whitespace tolerant.
    expect(
      isSyntheticOrderRow(makeLine('68208', 'PENDING', { name: '  Order 99 ' })),
    ).toBe(true);
    // The order-prefixed webhook key alone doesn't make it real.
    expect(
      isSyntheticOrderRow(makeLine('order:8534895', 'PENDING', { name: 'Order 8534895' })),
    ).toBe(true);
  });

  test('an order:* row with a REAL service name is not synthetic (regression: Payton Harris)', () => {
    // AccuSource sends the drug screen as a lab payload carrying order_id but
    // no service_id, so it lands keyed `order:9357174` while naming itself
    // properly. The old id-prefix rule hid this genuine result and the panel
    // rendered "(0)".
    expect(
      isSyntheticOrderRow(
        makeLine('order:9357174', 'PASSED', { name: 'Quest Drug Screen', status: 'Collection is complete' }),
      ),
    ).toBe(false);
  });

  test('a placeholder-named row still shows once it carries a verdict (hiding it would hide review work)', () => {
    // When the named webhook never arrives the row keeps its "Order N" name,
    // but the vendor still reports status and auto-verdict can land it in
    // NEEDS_REVIEW — real adjudication work per policy §4/§6. Showing a
    // plainly-named row beats silently dropping a case from the reviewer.
    expect(
      isSyntheticOrderRow(
        makeLine('order:9357172', 'NEEDS_REVIEW', { name: 'Order 9357172', status: 'Completed' }),
      ),
    ).toBe(false);
    expect(
      isSyntheticOrderRow(makeLine('order:1', 'FAILED', { name: 'Order 1' })),
    ).toBe(false);
    expect(
      isSyntheticOrderRow(makeLine('order:2', 'PASSED', { name: 'Order 2' })),
    ).toBe(false);
  });

  test('does NOT filter real service lines', () => {
    expect(isSyntheticOrderRow(makeLine('68208', 'PENDING', { name: 'County Criminal' }))).toBe(false);
    expect(isSyntheticOrderRow(makeLine('68208', 'PASSED', { name: 'SSN Trace' }))).toBe(false);
    // A name containing "order" but not at the start is not synthetic.
    expect(
      isSyntheticOrderRow(makeLine('68208', 'PASSED', { name: 'Federal Order Search' })),
    ).toBe(false);
    // Just the word "Order" without an id is not the synthetic pattern.
    expect(isSyntheticOrderRow(makeLine('68208', 'PASSED', { name: 'Order' }))).toBe(false);
  });
});

describe('groupLinesByBand', () => {
  test('returns empty arrays for every band when given no lines', () => {
    const grouped = groupLinesByBand([]);
    expect(grouped.NEEDS_REVIEW).toEqual([]);
    expect(grouped.FAILED).toEqual([]);
    expect(grouped.PENDING).toEqual([]);
    expect(grouped.PASSED).toEqual([]);
  });

  test('groups lines into the correct band by their effective verdict', () => {
    const lines = [
      makeLine('a', 'NEEDS_REVIEW'),
      makeLine('b', 'PASSED'),
      makeLine('c', 'PENDING'),
      makeLine('d', 'FAILED'),
      makeLine('e', 'PASSED'),
      makeLine('f', 'NEEDS_REVIEW'),
    ];
    const grouped = groupLinesByBand(lines);
    expect(grouped.NEEDS_REVIEW.map((l) => l.id)).toEqual(['a', 'f']);
    expect(grouped.FAILED.map((l) => l.id)).toEqual(['d']);
    expect(grouped.PENDING.map((l) => l.id)).toEqual(['c']);
    expect(grouped.PASSED.map((l) => l.id)).toEqual(['b', 'e']);
  });

  test('preserves the input order within each band (stable grouping)', () => {
    const lines = [
      makeLine('first', 'NEEDS_REVIEW'),
      makeLine('second', 'NEEDS_REVIEW'),
      makeLine('third', 'NEEDS_REVIEW'),
    ];
    const grouped = groupLinesByBand(lines);
    expect(grouped.NEEDS_REVIEW.map((l) => l.id)).toEqual(['first', 'second', 'third']);
  });

  test('filters synthetic order:* rows by default', () => {
    // A real synthetic carries the placeholder "Order N" name the vendor's
    // order-level webhook produces (see accusourceWebhookServiceLine).
    const lines = [
      makeLine('order:8534895', 'PENDING', { name: 'Order 8534895' }),
      makeLine('68208', 'PASSED', { name: 'County Criminal' }),
      makeLine('68209', 'PENDING', { name: 'Order 12345' }),
    ];
    const grouped = groupLinesByBand(lines);
    // Only the real service line survives.
    expect(grouped.PASSED.map((l) => l.id)).toEqual(['68208']);
    expect(grouped.PENDING).toEqual([]);
  });

  test('opts.keepSynthetic preserves order:* rows for callers that need them (none today)', () => {
    const lines = [
      makeLine('order:8534895', 'PENDING', { name: 'Order 8534895' }),
      makeLine('68208', 'PASSED', { name: 'County Criminal' }),
    ];
    const grouped = groupLinesByBand(lines, { keepSynthetic: true });
    expect(grouped.PENDING.map((l) => l.id)).toEqual(['order:8534895']);
    expect(grouped.PASSED.map((l) => l.id)).toEqual(['68208']);
  });
});

describe('totalVisibleLineCount', () => {
  test('sums non-synthetic lines so the card header matches what the user can scroll through', () => {
    const lines = [
      makeLine('a', 'PASSED'),
      makeLine('order:1', 'PENDING', { name: 'Order 1' }),
      makeLine('b', 'NEEDS_REVIEW'),
      makeLine('c', 'PENDING', { name: 'Order 5' }),
    ];
    expect(totalVisibleLineCount(lines)).toBe(2);
  });

  test('returns zero when every line is synthetic', () => {
    expect(
      totalVisibleLineCount([
        makeLine('order:1', 'PENDING', { name: 'Order 1' }),
        makeLine('order:2', 'PENDING', { name: 'Order 2' }),
      ]),
    ).toBe(0);
  });

  test('counts a completed placeholder awaiting review — hiding it would hide the case', () => {
    // Payton Harris (2026-07-15): two lines whose named webhook never arrived
    // still carried Completed + NEEDS_REVIEW. The panel must not read "(0)".
    expect(
      totalVisibleLineCount([
        makeLine('order:9357172', 'NEEDS_REVIEW', { name: 'Order 9357172', status: 'Completed' }),
        makeLine('order:9357174', 'PASSED', { name: 'Quest Drug Screen' }),
        makeLine('order:9357179', 'NEEDS_REVIEW', { name: 'Order 9357179', status: 'Completed' }),
      ]),
    ).toBe(3);
  });
});

describe('cardHeaderSubBadge', () => {
  test('returns "N needs review" when ≥1 needs-review line (singular vs plural)', () => {
    const oneReview = {
      NEEDS_REVIEW: [{}],
      FAILED: [],
      PENDING: [],
      PASSED: [],
    };
    expect(cardHeaderSubBadge(oneReview)).toEqual({
      label: '1 needs review',
      severity: 'warning',
    });

    const twoReview = {
      NEEDS_REVIEW: [{}, {}],
      FAILED: [],
      PENDING: [],
      PASSED: [],
    };
    expect(cardHeaderSubBadge(twoReview)).toEqual({
      label: '2 need review',
      severity: 'warning',
    });
  });

  test('falls back to "N failed" when no needs-review but ≥1 failed', () => {
    const failed = {
      NEEDS_REVIEW: [],
      FAILED: [{}, {}, {}],
      PENDING: [{}],
      PASSED: [{}],
    };
    expect(cardHeaderSubBadge(failed)).toEqual({
      label: '3 failed',
      severity: 'error',
    });
  });

  test('needs-review wins over failed (the spec-stated priority)', () => {
    const both = {
      NEEDS_REVIEW: [{}],
      FAILED: [{}, {}],
      PENDING: [],
      PASSED: [],
    };
    expect(cardHeaderSubBadge(both)?.severity).toBe('warning');
    expect(cardHeaderSubBadge(both)?.label).toBe('1 needs review');
  });

  test('returns null when nothing is actionable (no badge renders)', () => {
    const allPassed = {
      NEEDS_REVIEW: [],
      FAILED: [],
      PENDING: [{}],
      PASSED: [{}, {}],
    };
    expect(cardHeaderSubBadge(allPassed)).toBeNull();

    const empty = {
      NEEDS_REVIEW: [],
      FAILED: [],
      PENDING: [],
      PASSED: [],
    };
    expect(cardHeaderSubBadge(empty)).toBeNull();
  });
});

describe('isAllPendingState', () => {
  test('true when ONLY the pending band has lines', () => {
    expect(
      isAllPendingState({
        NEEDS_REVIEW: [],
        FAILED: [],
        PENDING: [{}, {}, {}],
        PASSED: [],
      }),
    ).toBe(true);
  });

  test('false when any actionable band has lines', () => {
    expect(
      isAllPendingState({
        NEEDS_REVIEW: [{}],
        FAILED: [],
        PENDING: [{}, {}],
        PASSED: [],
      }),
    ).toBe(false);
    expect(
      isAllPendingState({
        NEEDS_REVIEW: [],
        FAILED: [{}],
        PENDING: [{}, {}],
        PASSED: [],
      }),
    ).toBe(false);
    expect(
      isAllPendingState({
        NEEDS_REVIEW: [],
        FAILED: [],
        PENDING: [{}, {}],
        PASSED: [{}],
      }),
    ).toBe(false);
  });

  test('false when pending is empty (the worker has no lines at all)', () => {
    expect(
      isAllPendingState({
        NEEDS_REVIEW: [],
        FAILED: [],
        PENDING: [],
        PASSED: [],
      }),
    ).toBe(false);
  });
});
