/**
 * AC.0a — Component test for the verdict-banded layout of
 * `AccusourceOrderServiceLinesTable`.
 *
 * Locks the user-visible structure that CSAs depend on:
 *   - All four bands render when each has ≥1 row.
 *   - Bands with zero rows are hidden entirely.
 *   - Band order (top-to-bottom): Needs review → Failed → Pending → Passed.
 *   - Synthetic `order:*` rows that survived the line builder's dedup are
 *     filtered out of the table.
 *   - Card header shows the visible-line count + the "needs review"
 *     sub-badge when N > 0.
 *   - Empty state renders when the worker has no service lines at all.
 *   - The "Review" button on a Needs review row opens the override menu
 *     pre-loaded for that line.
 *   - Submitting an override optimistically moves the row to its new band
 *     (the AC.0a optimistic-local-overrides path — pre-AC.0a there was no
 *     parent re-fetch, so without this the row would stay put).
 *
 * Pure helper coverage lives in `src/utils/__tests__/accusourceVerdictBands.test.ts`.
 *
 * **Why `data-testid` for band/row queries.** Band header buttons share
 * an accessible-name pattern ("Needs review band, 1 item") with row
 * buttons whose status / verdict chips include matching substrings
 * ("County Criminal Pending Review Needs review …"). Querying by
 * accessible name makes tests fragile to product copy. The component
 * exposes stable testids exactly for this purpose.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Timestamp } from 'firebase/firestore';

import AccusourceOrderServiceLinesTable from '../AccusourceOrderServiceLinesTable';
import type {
  AccusourceLineAdjudication,
  AccusourceLineVerdict,
  BackgroundCheckRecord,
  ServiceOrderStatusEntry,
} from '../../../../types/backgroundCheck';

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a `providerServiceOrderStatus` entry whose `adjudication.autoVerdict`
 * matches the requested verdict. The line builder runs
 * `resolveEffectiveVerdict(adjudication)` which returns `autoVerdict` when
 * no manual override is set — exactly what we want for fixture lines.
 */
function adjudicated(
  verdict: AccusourceLineVerdict,
  reason?: string,
): { adjudication: AccusourceLineAdjudication } {
  return {
    adjudication: {
      autoVerdict: verdict,
      autoVerdictReason: reason ?? null,
      verdict: null,
    },
  };
}

function entry(
  override: Partial<ServiceOrderStatusEntry> & {
    adjudication?: AccusourceLineAdjudication;
  } = {},
): ServiceOrderStatusEntry {
  return {
    status: 'In Progress',
    updatedAt: null as unknown as Timestamp,
    ...override,
  };
}

function record(
  partial: Partial<BackgroundCheckRecord> = {},
): BackgroundCheckRecord {
  return {
    id: 'BGC_TEST',
    provider: 'accusource',
    candidateId: 'WORKER_TEST',
    candidateName: 'Demetrius Lewis',
    accountName: 'C1 Select LLC',
    tenantId: 'TENANT_TEST',
    requestedServicesCatalog: [],
    providerServiceOrderStatus: {},
    ...partial,
  };
}

/** Standard 4-band fixture used by the band-render + sort-order tests. */
function fourBandRecord(): BackgroundCheckRecord {
  return record({
    requestedServicesCatalog: [
      { id: 'svc_review', name: 'County Criminal' },
      { id: 'svc_passed', name: 'SSN Trace' },
      { id: 'svc_pending', name: 'Drug Screen 5-Panel' },
      { id: 'svc_failed', name: 'MVR' },
    ],
    providerServiceOrderStatus: {
      svc_review: entry({
        status: 'Pending Review',
        ...adjudicated('NEEDS_REVIEW', 'Records returned — needs adjudication'),
      }),
      svc_passed: entry({
        status: 'Completed',
        reportUrl: 'https://reports.example/passed.pdf',
        ...adjudicated('PASSED', 'Status completed, no records returned'),
      }),
      svc_pending: entry({
        status: 'In Progress',
        // No adjudication → resolveEffectiveVerdict returns 'PENDING'
      }),
      svc_failed: entry({
        status: 'Completed',
        reportUrl: 'https://reports.example/failed.pdf',
        ...adjudicated('FAILED', 'Records returned — disqualifying'),
      }),
    },
  });
}

const BAND_TESTID = {
  NEEDS_REVIEW: 'accusource-band-header-needs_review',
  FAILED: 'accusource-band-header-failed',
  PENDING: 'accusource-band-header-pending',
  PASSED: 'accusource-band-header-passed',
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe('AccusourceOrderServiceLinesTable — AC.0a verdict bands', () => {
  test('renders all four bands when each has ≥1 row', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);
    expect(screen.getByTestId(BAND_TESTID.NEEDS_REVIEW)).toBeInTheDocument();
    expect(screen.getByTestId(BAND_TESTID.FAILED)).toBeInTheDocument();
    expect(screen.getByTestId(BAND_TESTID.PENDING)).toBeInTheDocument();
    expect(screen.getByTestId(BAND_TESTID.PASSED)).toBeInTheDocument();
  });

  test('hides bands with zero rows (only Needs review present)', () => {
    const r = record({
      requestedServicesCatalog: [{ id: 'svc_only', name: 'County Criminal' }],
      providerServiceOrderStatus: {
        svc_only: entry({
          status: 'Pending Review',
          ...adjudicated('NEEDS_REVIEW'),
        }),
      },
    });
    render(<AccusourceOrderServiceLinesTable record={r} />);

    expect(screen.getByTestId(BAND_TESTID.NEEDS_REVIEW)).toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.FAILED)).not.toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.PENDING)).not.toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.PASSED)).not.toBeInTheDocument();
  });

  test('Needs review band renders first; Passed band renders last', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);

    // Spec: top-to-bottom = Needs review → Failed → Pending → Passed.
    const headers = [
      screen.getByTestId(BAND_TESTID.NEEDS_REVIEW),
      screen.getByTestId(BAND_TESTID.FAILED),
      screen.getByTestId(BAND_TESTID.PENDING),
      screen.getByTestId(BAND_TESTID.PASSED),
    ];

    // Walk the DOM using `compareDocumentPosition`: each header must come
    // before the next in document order.
    for (let i = 0; i < headers.length - 1; i += 1) {
      const before = headers[i];
      const after = headers[i + 1];
      expect(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test('Needs review + Failed expanded by default; Pending + Passed collapsed', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);

    expect(screen.getByTestId(BAND_TESTID.NEEDS_REVIEW)).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId(BAND_TESTID.FAILED)).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByTestId(BAND_TESTID.PENDING)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByTestId(BAND_TESTID.PASSED)).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    // Default-expanded bands have their rows in the DOM:
    expect(screen.getByText('County Criminal')).toBeInTheDocument();
    expect(screen.getByText('MVR')).toBeInTheDocument();
    // Default-collapsed bands do NOT (Collapse `unmountOnExit`):
    expect(screen.queryByText('SSN Trace')).not.toBeInTheDocument();
    expect(screen.queryByText('Drug Screen 5-Panel')).not.toBeInTheDocument();
  });

  test('clicking a collapsed band header expands it and reveals its rows', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);

    const passedHeader = screen.getByTestId(BAND_TESTID.PASSED);
    expect(passedHeader).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(passedHeader);
    expect(passedHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('SSN Trace')).toBeInTheDocument();
  });

  test('filters out synthetic order:* rows from the table', () => {
    // The line builder's 90s dedup keeps `order:*` rows when no named
    // twin exists; the AC.0a UI guard then strips them. Use a unique
    // status so dedup wouldn't fire even if there WERE a twin (defensive).
    const r = record({
      requestedServicesCatalog: [{ id: 'svc_real', name: 'County Criminal' }],
      providerServiceOrderStatus: {
        svc_real: entry({
          status: 'Pending Review',
          ...adjudicated('NEEDS_REVIEW'),
        }),
        'order:8534895': entry({
          status: 'Distinctive Status',
          serviceName: 'Order 8534895',
          ...adjudicated('PENDING'),
        }),
      },
    });
    render(<AccusourceOrderServiceLinesTable record={r} />);

    // The real line is visible…
    expect(screen.getByText('County Criminal')).toBeInTheDocument();
    // …but the synthetic order:* row is not rendered anywhere.
    expect(screen.queryByText('Order 8534895')).not.toBeInTheDocument();
    expect(screen.queryByTestId('accusource-row-order:8534895')).not.toBeInTheDocument();
  });

  test('card header shows total visible count + "needs review" sub-badge when N>0', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);
    expect(screen.getByText(/AccuSource service lines \(4\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 needs review/i)).toBeInTheDocument();
  });

  test('card header omits the sub-badge when nothing is actionable', () => {
    const r = record({
      requestedServicesCatalog: [{ id: 'svc_pass', name: 'SSN Trace' }],
      providerServiceOrderStatus: {
        svc_pass: entry({
          status: 'Completed',
          ...adjudicated('PASSED'),
        }),
      },
    });
    render(<AccusourceOrderServiceLinesTable record={r} />);

    expect(screen.getByText(/AccuSource service lines \(1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/needs review/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^[0-9]+ failed/i)).not.toBeInTheDocument();
  });

  test('renders the existing empty state when the worker has no service lines', () => {
    render(<AccusourceOrderServiceLinesTable record={record()} />);
    expect(screen.getByText(/No ordered screens yet/i)).toBeInTheDocument();
    // No band headers render.
    expect(screen.queryByTestId(BAND_TESTID.NEEDS_REVIEW)).not.toBeInTheDocument();
  });

  test('renders an "all checks still in progress" alert when only the Pending band has rows', () => {
    const r = record({
      requestedServicesCatalog: [
        { id: 'svc_a', name: 'County Criminal' },
        { id: 'svc_b', name: 'SSN Trace' },
      ],
      providerServiceOrderStatus: {
        svc_a: entry({ status: 'In Progress' }),
        svc_b: entry({ status: 'In Progress' }),
      },
    });
    render(<AccusourceOrderServiceLinesTable record={r} />);
    expect(
      screen.getByText(/All checks are still in progress with the vendor/i),
    ).toBeInTheDocument();
    // Only the Pending band header renders.
    expect(screen.getByTestId(BAND_TESTID.PENDING)).toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.NEEDS_REVIEW)).not.toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.FAILED)).not.toBeInTheDocument();
    expect(screen.queryByTestId(BAND_TESTID.PASSED)).not.toBeInTheDocument();
  });

  test('Needs review row exposes a primary "Review" button (not a kebab)', () => {
    const onSetAdjudication = jest.fn().mockResolvedValue(undefined);
    render(
      <AccusourceOrderServiceLinesTable
        record={fourBandRecord()}
        onSetAdjudication={onSetAdjudication}
      />,
    );
    expect(screen.getByRole('button', { name: /^Review$/i })).toBeInTheDocument();
  });

  test('clicking "Review" opens the override menu pre-scoped to that line', async () => {
    const onSetAdjudication = jest.fn().mockResolvedValue(undefined);
    render(
      <AccusourceOrderServiceLinesTable
        record={fourBandRecord()}
        onSetAdjudication={onSetAdjudication}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Review$/i }));

    // Menu header echoes "Override verdict for [name]"
    expect(await screen.findByText(/Override verdict for/i)).toBeInTheDocument();
    // All three override actions are present.
    expect(screen.getByRole('menuitem', { name: /Mark as Passed/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Mark as Failed/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Flag as Needs review/i })).toBeInTheDocument();
  });

  test('after submit, optimistic local override moves the row to its new band immediately', async () => {
    const onSetAdjudication = jest.fn().mockResolvedValue(undefined);
    render(
      <AccusourceOrderServiceLinesTable
        record={fourBandRecord()}
        onSetAdjudication={onSetAdjudication}
      />,
    );

    // Sanity: County Criminal starts in the Needs review band.
    expect(screen.getByTestId('accusource-row-svc_review')).toBeInTheDocument();

    // 1. Open the override menu via the Review button.
    fireEvent.click(screen.getByRole('button', { name: /^Review$/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Mark as Passed/i }));

    // 2. Submit the dialog.
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Save override/i }));

    // 3. Callable was invoked with the right args.
    await waitFor(() => {
      expect(onSetAdjudication).toHaveBeenCalledWith(
        'BGC_TEST',
        'svc_review',
        'PASSED',
        null,
      );
    });

    // 4. Needs review band hides (its only row was County Criminal which
    //    just moved to Passed).
    await waitFor(() => {
      expect(screen.queryByTestId(BAND_TESTID.NEEDS_REVIEW)).not.toBeInTheDocument();
    });

    // 5. The Passed band header still exists; expand it and verify the
    //    moved row landed there alongside the original SSN Trace.
    fireEvent.click(screen.getByTestId(BAND_TESTID.PASSED));
    expect(screen.getByText('County Criminal')).toBeInTheDocument();
    expect(screen.getByText('SSN Trace')).toBeInTheDocument();
  });

  test('Failed band exposes a "View report" primary action linking to reportUrl', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);

    // Failed band is expanded by default; its row carries a "View report" link.
    const links = screen.getAllByRole('link', { name: /View report/i });
    // At least the Failed band's link is present (Passed is collapsed so won't show).
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute('href', 'https://reports.example/failed.pdf');
  });

  test('Pending band rows render no action button (informational only)', () => {
    const r = record({
      requestedServicesCatalog: [{ id: 'svc_p', name: 'Drug Screen 5-Panel' }],
      providerServiceOrderStatus: {
        svc_p: entry({ status: 'In Progress' }),
      },
    });
    render(<AccusourceOrderServiceLinesTable record={r} onSetAdjudication={jest.fn()} />);

    // Only the Pending band renders (all-pending state). Within it there
    // is no Review / View report / kebab.
    expect(screen.queryByRole('button', { name: /^Review$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View report/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Override verdict for/i }),
    ).not.toBeInTheDocument();
  });

  test('clicking a row body toggles its inline details panel', () => {
    render(<AccusourceOrderServiceLinesTable record={fourBandRecord()} />);

    // The Needs review row is the easiest to target — it's rendered by
    // default and has a stable testid.
    const rowHeader = screen.getByTestId('accusource-row-header-svc_review');
    expect(rowHeader).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rowHeader);
    expect(rowHeader).toHaveAttribute('aria-expanded', 'true');

    // Details panel reveals the Component ID label (one of the rows in
    // `renderDetailsPanel`).
    expect(screen.getByText(/Component ID/i)).toBeInTheDocument();
    expect(screen.getByText('svc_review')).toBeInTheDocument();
  });
});
